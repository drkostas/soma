// web/app/api/playlist/spotify/library/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { spotifyFetch } from "@/lib/spotify-client";
import { fetchAudioFeatures } from "@/lib/reccobeats-client";
import { getArtistTopTags } from "@/lib/lastfm-client";
import { toMacroGenres } from "@/lib/genre-mapper";

export const runtime = "nodejs";
export const maxDuration = 60;

interface SpotifyTrack {
  id: string;
  name: string;
  type: string;
  is_local: boolean;
  duration_ms: number;
  artists: Array<{ id: string; name: string }>;
}

async function fetchSourceTracks(sourceId: string): Promise<SpotifyTrack[]> {
  const tracks: SpotifyTrack[] = [];
  let url: string | null =
    sourceId === "liked"
      ? "/me/tracks?limit=50"
      : `/playlists/${sourceId}/tracks?limit=50`;

  while (url) {
    const res = await spotifyFetch(url);
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get("Retry-After") ?? "5", 10);
      await new Promise((r) => setTimeout(r, Math.min(retryAfter, 10) * 1000));
      continue; // retry same url
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Spotify ${res.status} for ${url}: ${body.slice(0, 120)}`);
    }
    const data = await res.json();
    for (const item of data.items ?? []) {
      const t: SpotifyTrack = item.track ?? item;
      if (t && t.type === "track" && !t.is_local && t.id) tracks.push(t);
    }
    url = data.next
      ? (data.next as string).replace("https://api.spotify.com/v1", "")
      : null;
  }
  return tracks;
}

function enc(event: string, data: object): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const sourceIds: string[] = body.source_ids ?? ["liked"];

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const sql = getDb();

        // Stage 1: fetch tracks from Spotify
        controller.enqueue(enc("progress", { stage: "Fetching tracks from Spotify…", pct: 5 }));
        const allTracks = new Map<string, SpotifyTrack>();
        for (const sid of sourceIds) {
          const tracks = await fetchSourceTracks(sid);
          for (const t of tracks) allTracks.set(t.id, t);
        }
        const allIds = Array.from(allTracks.keys());
        controller.enqueue(enc("progress", { stage: `Found ${allIds.length} tracks`, pct: 15 }));

        if (allIds.length === 0) {
          controller.enqueue(enc("done", { cached: 0, new: 0, total: 0 }));
          return;
        }

        // Stage 2: filter cached tracks — only skip those that already have BPM data (tempo IS NOT NULL)
        const existing = await sql`SELECT track_id FROM spotify_track_features WHERE track_id = ANY(${allIds}) AND tempo IS NOT NULL`;
        const existingSet = new Set((existing as Array<{ track_id: string }>).map((r) => r.track_id));
        const newIds = allIds.filter((id) => !existingSet.has(id));

        if (newIds.length === 0) {
          controller.enqueue(enc("done", { cached: allIds.length, new: 0, total: allIds.length }));
          return;
        }

        controller.enqueue(enc("progress", {
          stage: `${newIds.length} new tracks to analyse (${existingSet.size} cached)`,
          pct: 20,
        }));

        // Stage 3: BPM fetch from ReccoBeats
        controller.enqueue(enc("progress", { stage: "Fetching BPM & energy data…", pct: 25 }));
        const features = await fetchAudioFeatures(newIds);
        controller.enqueue(enc("progress", { stage: "BPM data fetched", pct: 40 }));

        // Stage 4: artist genres — batch 20 at a time (Spotify /artists?ids=)
        const artistIds = new Set<string>();
        for (const id of newIds) {
          const artistId = allTracks.get(id)?.artists?.[0]?.id;
          if (artistId) artistIds.add(artistId);
        }

        const cachedArtists = await sql`SELECT artist_id FROM spotify_artist_genres WHERE artist_id = ANY(${Array.from(artistIds)})`;
        const cachedArtistSet = new Set((cachedArtists as Array<{ artist_id: string }>).map((r) => r.artist_id));
        const newArtistIds = Array.from(artistIds).filter((id) => !cachedArtistSet.has(id));

        const BATCH = 20;
        let artistsDone = 0;
        for (let i = 0; i < newArtistIds.length; i += BATCH) {
          const batch = newArtistIds.slice(i, i + BATCH);
          const res = await spotifyFetch(`/artists?ids=${batch.join(",")}`);
          if (res.ok) {
            const data = await res.json();
            for (const artist of data.artists ?? []) {
              if (!artist) continue;
              let genres: string[] = artist.genres ?? [];
              let source = "spotify";
              if (genres.length === 0) {
                genres = await getArtistTopTags(artist.name as string);
                source = "lastfm";
              }
              const macroGenres = toMacroGenres(genres);
              await sql`
                INSERT INTO spotify_artist_genres (artist_id, artist_name, genres, macro_genres, source)
                VALUES (${artist.id as string}, ${artist.name as string}, ${genres}, ${macroGenres}, ${source})
                ON CONFLICT (artist_id) DO NOTHING
              `;
            }
          }
          artistsDone += batch.length;
          const pct = 40 + Math.round((artistsDone / Math.max(newArtistIds.length, 1)) * 30);
          controller.enqueue(enc("progress", {
            stage: `Fetching artist genres… ${artistsDone}/${newArtistIds.length}`,
            pct,
          }));
        }

        // Stage 5: resolve genre map + insert tracks
        const genreRows = await sql`SELECT artist_id, macro_genres FROM spotify_artist_genres WHERE artist_id = ANY(${Array.from(artistIds)})`;
        const genreMap = new Map((genreRows as Array<{ artist_id: string; macro_genres: string[] }>).map((r) => [r.artist_id, r.macro_genres]));

        controller.enqueue(enc("progress", { stage: `Saving ${newIds.length} tracks to database…`, pct: 72 }));

        let inserted = 0;
        for (const id of newIds) {
          const t = allTracks.get(id)!;
          const f = features.get(id);
          const artistId = t.artists?.[0]?.id ?? "";
          const artistName = t.artists?.[0]?.name ?? "";
          const macroGenres = genreMap.get(artistId) ?? [];
          await sql`
            INSERT INTO spotify_track_features
              (track_id, name, artist_id, artist_name, duration_ms, tempo, energy, valence, danceability, genres)
            VALUES (${id}, ${t.name}, ${artistId}, ${artistName}, ${t.duration_ms},
                    ${f?.tempo ?? null}, ${f?.energy ?? null}, ${f?.valence ?? null},
                    ${f?.danceability ?? null}, ${macroGenres})
            ON CONFLICT (track_id) DO UPDATE SET
              tempo = EXCLUDED.tempo, energy = EXCLUDED.energy,
              valence = EXCLUDED.valence, danceability = EXCLUDED.danceability,
              genres = EXCLUDED.genres
          `;
          inserted++;
          if (inserted % 50 === 0) {
            controller.enqueue(enc("progress", {
              stage: `Saving tracks… ${inserted}/${newIds.length}`,
              pct: 72 + Math.round((inserted / newIds.length) * 25),
            }));
          }
        }

        controller.enqueue(enc("done", { cached: existingSet.size, new: inserted, total: allIds.length }));
      } catch (err) {
        controller.enqueue(enc("error", { message: String(err) }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}

export async function GET() {
  const sql = getDb();
  const rows = await sql`
    SELECT
      COUNT(*) AS total_tracks,
      COUNT(*) FILTER (WHERE tempo IS NOT NULL) AS tracks_with_bpm,
      MAX(cached_at) AS last_synced
    FROM spotify_track_features
  `;
  return NextResponse.json(rows[0]);
}
