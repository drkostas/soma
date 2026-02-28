// web/app/api/playlist/spotify/library/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { spotifyFetch } from "@/lib/spotify-client";
import { fetchAudioFeatures } from "@/lib/reccobeats-client";
import { getArtistTopTags } from "@/lib/lastfm-client";
import { toMacroGenres } from "@/lib/genre-mapper";

export const runtime = "nodejs";
export const maxDuration = 60; // Vercel: allow up to 60s for large libraries

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
    if (!res.ok) break;
    const data = await res.json();
    for (const item of data.items ?? []) {
      const t: SpotifyTrack = item.track ?? item;
      if (t && t.type === "track" && !t.is_local && t.id) {
        tracks.push(t);
      }
    }
    // data.next is the full URL like https://api.spotify.com/v1/...
    url = data.next
      ? (data.next as string).replace("https://api.spotify.com/v1", "")
      : null;
  }
  return tracks;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const sourceIds: string[] = body.source_ids ?? ["liked"];

  const sql = getDb();

  // 1. Collect all unique tracks from all sources
  const allTracks = new Map<string, SpotifyTrack>();
  for (const sid of sourceIds) {
    const tracks = await fetchSourceTracks(sid);
    for (const t of tracks) allTracks.set(t.id, t);
  }

  const allIds = Array.from(allTracks.keys());
  if (allIds.length === 0) {
    return NextResponse.json({ cached: 0, new: 0, total: 0 });
  }

  // 2. Filter out already-cached tracks
  const existing = await sql`
    SELECT track_id FROM spotify_track_features WHERE track_id = ANY(${allIds})
  `;
  const existingSet = new Set((existing as Array<{ track_id: string }>).map((r) => r.track_id));
  const newIds = allIds.filter((id) => !existingSet.has(id));

  if (newIds.length === 0) {
    return NextResponse.json({ cached: allIds.length, new: 0, total: allIds.length });
  }

  // 3. Batch BPM fetch from ReccoBeats
  const features = await fetchAudioFeatures(newIds);

  // 4. Collect unique artist IDs needing genre fetch
  const artistIds = new Set<string>();
  for (const id of newIds) {
    const artistId = allTracks.get(id)?.artists?.[0]?.id;
    if (artistId) artistIds.add(artistId);
  }

  // Filter already-cached artists
  const cachedArtists = await sql`
    SELECT artist_id FROM spotify_artist_genres WHERE artist_id = ANY(${Array.from(artistIds)})
  `;
  const cachedArtistSet = new Set(
    (cachedArtists as Array<{ artist_id: string }>).map((r) => r.artist_id)
  );

  // Fetch and cache new artist genres
  for (const artistId of artistIds) {
    if (cachedArtistSet.has(artistId)) continue;

    const res = await spotifyFetch(`/artists/${artistId}`);
    if (!res.ok) continue;
    const artist = await res.json();
    let genres: string[] = artist.genres ?? [];
    let source = "spotify";

    if (genres.length === 0) {
      genres = await getArtistTopTags(artist.name as string);
      source = "lastfm";
    }

    const macroGenres = toMacroGenres(genres);

    await sql`
      INSERT INTO spotify_artist_genres (artist_id, artist_name, genres, macro_genres, source)
      VALUES (${artistId}, ${artist.name as string}, ${genres}, ${macroGenres}, ${source})
      ON CONFLICT (artist_id) DO NOTHING
    `;
  }

  // 5. Resolve artist genre map from DB
  const genreRows = await sql`
    SELECT artist_id, macro_genres FROM spotify_artist_genres
    WHERE artist_id = ANY(${Array.from(artistIds)})
  `;
  const genreMap = new Map(
    (genreRows as Array<{ artist_id: string; macro_genres: string[] }>).map((r) => [
      r.artist_id,
      r.macro_genres,
    ])
  );

  // 6. Insert track features
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
      VALUES (
        ${id},
        ${t.name},
        ${artistId},
        ${artistName},
        ${t.duration_ms},
        ${f?.tempo ?? null},
        ${f?.energy ?? null},
        ${f?.valence ?? null},
        ${f?.danceability ?? null},
        ${macroGenres}
      )
      ON CONFLICT (track_id) DO UPDATE SET
        tempo = EXCLUDED.tempo,
        energy = EXCLUDED.energy,
        valence = EXCLUDED.valence,
        danceability = EXCLUDED.danceability,
        genres = EXCLUDED.genres
    `;
    inserted++;
  }

  return NextResponse.json({ cached: existingSet.size, new: inserted, total: allIds.length });
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
