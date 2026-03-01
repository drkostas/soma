// web/app/api/playlist/spotify/library/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { spotifyFetch } from "@/lib/spotify-client";
import { fetchAudioFeatures } from "@/lib/reccobeats-client";
import { getArtistTopTags } from "@/lib/lastfm-client";
import { toMacroGenres } from "@/lib/genre-mapper";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 min on Vercel (was 60)

interface SpotifyTrack {
  id: string;
  name: string;
  type: string;
  is_local: boolean;
  duration_ms: number;
  artists: Array<{ id: string; name: string }>;
}

// Fetch all tracks for a source, stopping early once we see 2 consecutive pages
// of tracks already in our DB. Spotify returns liked songs newest-first, so once
// we hit a run of known tracks the rest are older and already processed.
async function fetchSourceTracks(sourceId: string, knownIds?: Set<string>): Promise<SpotifyTrack[]> {
  const tracks: SpotifyTrack[] = [];
  let url: string | null =
    sourceId === "liked"
      ? "/me/tracks?limit=50"
      : `/playlists/${sourceId}/items?limit=50`;
  let consecutiveKnownPages = 0;

  while (url) {
    const res = await spotifyFetch(url);
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get("Retry-After") ?? "5", 10);
      if (retryAfter > 60) throw new Error(`Spotify rate-limited for ${Math.round(retryAfter / 60)} min. Try again later.`);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      continue; // retry same url
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Spotify ${res.status} for ${url}: ${body.slice(0, 120)}`);
    }
    const data = await res.json();
    const pageItems: SpotifyTrack[] = [];
    for (const item of data.items ?? []) {
      const t: SpotifyTrack = item.track ?? item;
      if (t && t.type === "track" && !t.is_local && t.id) pageItems.push(t);
    }
    tracks.push(...pageItems);

    // Early stop: 2 consecutive pages of all-known tracks → remainder is older, already saved
    if (knownIds && pageItems.length > 0 && pageItems.every((t) => knownIds.has(t.id))) {
      if (++consecutiveKnownPages >= 2) break;
    } else {
      consecutiveKnownPages = 0;
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
      // Safe enqueue: client disconnect should NOT abort DB saves
      const send = (event: string, data: object) => {
        try { controller.enqueue(enc(event, data)); } catch { /* ignore */ }
      };

      try {
        const sql = getDb();

        // Stage 1: fetch tracks from Spotify, stopping early for re-runs
        send("progress", { stage: "Fetching tracks from Spotify…", pct: 5 });

        // Pre-load all known track IDs so fetchSourceTracks can stop paginating
        // once it hits 2 consecutive pages of tracks already in our DB (newest-first order).
        const knownRows = await sql`SELECT track_id FROM spotify_track_features`;
        const knownSet = new Set((knownRows as Array<{ track_id: string }>).map((r) => r.track_id));

        const allTracks = new Map<string, SpotifyTrack>();
        for (const sid of sourceIds) {
          const tracks = await fetchSourceTracks(sid, knownSet);
          for (const t of tracks) allTracks.set(t.id, t);
        }
        const allIds = Array.from(allTracks.keys());
        send("progress", { stage: `Found ${allIds.length} tracks`, pct: 15 });

        if (allIds.length === 0) {
          send("done", { cached: 0, new: 0, total: 0 });
          return;
        }

        // Stage 2: filter cached tracks — only skip those that already have BPM data
        const existing = await sql`SELECT track_id FROM spotify_track_features WHERE track_id = ANY(${allIds}) AND tempo IS NOT NULL`;
        const existingSet = new Set((existing as Array<{ track_id: string }>).map((r) => r.track_id));
        const newIds = allIds.filter((id) => !existingSet.has(id));

        if (newIds.length === 0) {
          send("done", { cached: allIds.length, new: 0, total: allIds.length });
          return;
        }

        send("progress", {
          stage: `${newIds.length} tracks to analyse (${existingSet.size} cached)`,
          pct: 20,
        });

        // Stage 3: pre-fetch artist genres for all new tracks' artists
        const artistIds = new Set<string>();
        for (const id of newIds) {
          const artistId = allTracks.get(id)?.artists?.[0]?.id;
          if (artistId) artistIds.add(artistId);
        }

        const cachedArtistRows = await sql`SELECT artist_id, macro_genres FROM spotify_artist_genres WHERE artist_id = ANY(${Array.from(artistIds)})`;
        const genreMap = new Map((cachedArtistRows as Array<{ artist_id: string; macro_genres: string[] }>).map((r) => [r.artist_id, r.macro_genres]));
        const newArtistIds = Array.from(artistIds).filter((id) => !genreMap.has(id));

        send("progress", { stage: `Fetching genres for ${newArtistIds.length} artists…`, pct: 22 });

        const ARTIST_BATCH = 20;
        for (let i = 0; i < newArtistIds.length; i += ARTIST_BATCH) {
          const batch = newArtistIds.slice(i, i + ARTIST_BATCH);
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
                ON CONFLICT (artist_id) DO UPDATE SET
                  genres = EXCLUDED.genres, macro_genres = EXCLUDED.macro_genres,
                  source = EXCLUDED.source
                WHERE EXCLUDED.genres != '{}'::text[]
              `;
              genreMap.set(artist.id as string, macroGenres);
            }
          }
          const pct = 22 + Math.round(((i + ARTIST_BATCH) / Math.max(newArtistIds.length, 1)) * 8);
          send("progress", { stage: `Artist genres ${Math.min(i + ARTIST_BATCH, newArtistIds.length)}/${newArtistIds.length}`, pct });
        }

        // Stage 4: BPM fetch + save in chunks of 100 (incremental — saves persist even if client disconnects)
        send("progress", { stage: "Fetching BPM & saving tracks…", pct: 30 });
        const CHUNK = 100;
        let saved = 0;

        for (let i = 0; i < newIds.length; i += CHUNK) {
          const chunk = newIds.slice(i, i + CHUNK);

          // Fetch BPM for this chunk (single batch, ~0.8s)
          const features = await fetchAudioFeatures(chunk);

          // Save this chunk immediately — progress survives client disconnect
          for (const id of chunk) {
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
          }

          saved += chunk.length;
          const pct = 30 + Math.round((saved / newIds.length) * 67);
          send("progress", { stage: `Saved ${saved}/${newIds.length} tracks`, pct });

          // Brief pause between chunks to avoid rate limiting
          if (i + CHUNK < newIds.length) {
            await new Promise((r) => setTimeout(r, 200));
          }
        }

        send("done", { cached: existingSet.size, new: saved, total: allIds.length });
      } catch (err) {
        send("error", { message: err instanceof Error ? err.message : String(err) });
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
