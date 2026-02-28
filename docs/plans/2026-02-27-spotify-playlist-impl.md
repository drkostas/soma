# Spotify Playlist Generator — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a `/playlist` page in Soma that generates BPM-matched Spotify playlists from structured run segments using a lexicographic bi-criteria DP knapsack algorithm.

**Architecture:** Next.js App Router page with two-panel layout (run timeline left, song assignment right). Backend uses Server-Sent Events to stream algorithm results per-segment. Songs are cached from ReccoBeats (free BPM API, batch 100/call) and stored in Neon PostgreSQL. Framer Motion drives all animations.

**Tech Stack:** Next.js 16, TypeScript, Framer Motion, Spotify Web API + Web Playback SDK, ReccoBeats API, Last.fm API (genre fallback), Neon PostgreSQL, GH Actions (cron refresh)

**Worktree:** `/Users/gkos/projects/soma/.worktrees/spotify-playlist`
**Design doc:** `docs/plans/2026-02-27-spotify-playlist-design.md`
**Run:** `cd web && npm run dev` (port 3456)
**Build check:** `cd /Users/gkos/projects/soma/.worktrees/spotify-playlist/web && npm run build`

---

## Phase 1: Database + Infrastructure

### Task 1: DB Migration — 8 New Tables

**Files:**
- Create: `web/lib/db/migrations/20260227_spotify_playlist.sql`
- Modify: `web/lib/db.ts` (ensure migration runs or document manual apply)

**Step 1: Write the migration SQL**

```sql
-- web/lib/db/migrations/20260227_spotify_playlist.sql

-- Cached track BPM/energy/valence from ReccoBeats
CREATE TABLE IF NOT EXISTS spotify_track_features (
  track_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  artist_id TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  tempo FLOAT,
  energy FLOAT,
  valence FLOAT,
  danceability FLOAT,
  genres TEXT[] DEFAULT '{}',
  raw_genres TEXT[] DEFAULT '{}',
  cached_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stf_tempo ON spotify_track_features(tempo);
CREATE INDEX IF NOT EXISTS idx_stf_genres ON spotify_track_features USING GIN(genres);

-- Cached artist genres (from Spotify + Last.fm fallback)
CREATE TABLE IF NOT EXISTS spotify_artist_genres (
  artist_id TEXT PRIMARY KEY,
  artist_name TEXT NOT NULL,
  genres TEXT[] DEFAULT '{}',
  macro_genres TEXT[] DEFAULT '{}',
  source TEXT DEFAULT 'spotify',
  cached_at TIMESTAMPTZ DEFAULT NOW()
);

-- Saved workout plans (manual or from Garmin)
CREATE TABLE IF NOT EXISTS workout_plans (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  sport_type TEXT DEFAULT 'running',
  segments JSONB NOT NULL DEFAULT '[]',
  total_duration_s INTEGER,
  source TEXT DEFAULT 'manual',
  garmin_activity_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Playlist sessions (one per playlist generated)
CREATE TABLE IF NOT EXISTS playlist_sessions (
  id SERIAL PRIMARY KEY,
  workout_plan_id INTEGER REFERENCES workout_plans(id) ON DELETE SET NULL,
  garmin_activity_id TEXT,
  source_playlist_ids TEXT[] DEFAULT '{}',
  genre_selection TEXT[] DEFAULT '{}',
  genre_threshold FLOAT DEFAULT 0.03,
  song_assignments JSONB DEFAULT '{}',
  excluded_track_ids TEXT[] DEFAULT '{}',
  spotify_playlist_id TEXT,
  spotify_playlist_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Per-segment-type user preferences (persisted across sessions)
CREATE TABLE IF NOT EXISTS playlist_preferences (
  segment_type TEXT PRIMARY KEY,
  sync_mode TEXT DEFAULT 'auto',
  bpm_min INTEGER,
  bpm_max INTEGER,
  bpm_tolerance INTEGER DEFAULT 8,
  valence_min FLOAT,
  valence_max FLOAT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Permanently excluded tracks (never suggest again)
CREATE TABLE IF NOT EXISTS user_blacklist (
  track_id TEXT PRIMARY KEY,
  name TEXT,
  artist_name TEXT,
  blacklisted_at TIMESTAMPTZ DEFAULT NOW()
);

-- Track exclude count for blacklist learning (3 excludes → prompt)
CREATE TABLE IF NOT EXISTS track_exclude_counts (
  track_id TEXT PRIMARY KEY,
  exclude_count INTEGER DEFAULT 1,
  last_excluded_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pump-up song bank (max 10, user-curated)
CREATE TABLE IF NOT EXISTS pump_up_songs (
  track_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  tempo FLOAT,
  energy FLOAT,
  added_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Step 2: Apply migration to Neon DB**

Run in psql or Neon console:
```bash
psql "$DATABASE_URL" -f web/lib/db/migrations/20260227_spotify_playlist.sql
```
Expected: `CREATE TABLE` × 8, `CREATE INDEX` × 2, no errors.

**Step 3: Verify tables exist**

```bash
psql "$DATABASE_URL" -c "\dt spotify_* workout_plans playlist_* user_blacklist track_exclude_counts pump_up_songs"
```

**Step 4: Commit**

```bash
git add web/lib/db/migrations/20260227_spotify_playlist.sql
git commit -m "feat: add DB migration for spotify playlist tables"
```

---

### Task 2: Spotify OAuth — PKCE Flow

**Files:**
- Create: `web/app/api/playlist/spotify/auth/route.ts`
- Create: `web/app/api/playlist/spotify/callback/route.ts`
- Modify: `web/.env.local` (add SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REDIRECT_URI)

**Context:** Spotify uses PKCE (Proof Key for Code Exchange). We generate a `code_verifier` (random 64-byte hex), hash it to `code_challenge` (SHA-256, base64url), store verifier in a cookie, send challenge to Spotify. On callback, exchange code + verifier for tokens. Store tokens in `platform_credentials` table (same as Strava — check `web/lib/db.ts` for the existing table structure).

**Step 1: Check existing platform_credentials table**

```bash
psql "$DATABASE_URL" -c "\d platform_credentials"
```
Note columns. If it has `platform`, `access_token`, `refresh_token`, `expires_at`, `user_id` — we're good. If not, check how Strava stores its tokens in `web/app/api/strava/`.

**Step 2: Add env vars to `.env.local`**

Append to `web/.env.local`:
```
# Spotify OAuth
SPOTIFY_CLIENT_ID=your_client_id_here
SPOTIFY_CLIENT_SECRET=your_client_secret_here
SPOTIFY_REDIRECT_URI=http://localhost:3456/api/playlist/spotify/callback
```
(User needs to create a Spotify app at developer.spotify.com and fill these in.)

**Step 3: Write the auth initiation route**

```typescript
// web/app/api/playlist/spotify/auth/route.ts
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

const SCOPES = [
  "user-library-read",
  "playlist-read-private",
  "playlist-modify-private",
  "user-modify-playback-state",
  "user-read-playback-state",
].join(" ");

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export async function GET(req: NextRequest) {
  const verifier = base64url(crypto.randomBytes(64));
  const challenge = base64url(
    crypto.createHash("sha256").update(verifier).digest()
  );
  const state = base64url(crypto.randomBytes(16));

  const params = new URLSearchParams({
    client_id: process.env.SPOTIFY_CLIENT_ID!,
    response_type: "code",
    redirect_uri: process.env.SPOTIFY_REDIRECT_URI!,
    scope: SCOPES,
    code_challenge_method: "S256",
    code_challenge: challenge,
    state,
  });

  const res = NextResponse.redirect(
    `https://accounts.spotify.com/authorize?${params}`
  );
  res.cookies.set("spotify_pkce_verifier", verifier, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  });
  res.cookies.set("spotify_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  });
  return res;
}
```

**Step 4: Write the callback route**

```typescript
// web/app/api/playlist/spotify/callback/route.ts
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_BASE_URL}/connections?error=spotify_denied`);
  }

  const cookieVerifier = req.cookies.get("spotify_pkce_verifier")?.value;
  const cookieState = req.cookies.get("spotify_state")?.value;

  if (!code || !cookieVerifier || state !== cookieState) {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_BASE_URL}/connections?error=spotify_invalid`);
  }

  // Exchange code for tokens
  const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: process.env.SPOTIFY_REDIRECT_URI!,
      client_id: process.env.SPOTIFY_CLIENT_ID!,
      code_verifier: cookieVerifier,
    }),
  });

  if (!tokenRes.ok) {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_BASE_URL}/connections?error=spotify_token`);
  }

  const tokens = await tokenRes.json();
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  // Fetch Spotify user profile
  const profileRes = await fetch("https://api.spotify.com/v1/me", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const profile = await profileRes.json();

  // Store in platform_credentials (upsert by platform)
  await sql`
    INSERT INTO platform_credentials (platform, access_token, refresh_token, expires_at, external_user_id, display_name)
    VALUES ('spotify', ${tokens.access_token}, ${tokens.refresh_token}, ${expiresAt}, ${profile.id}, ${profile.display_name})
    ON CONFLICT (platform) DO UPDATE SET
      access_token = EXCLUDED.access_token,
      refresh_token = EXCLUDED.refresh_token,
      expires_at = EXCLUDED.expires_at,
      external_user_id = EXCLUDED.external_user_id,
      display_name = EXCLUDED.display_name
  `;

  const res = NextResponse.redirect(`${process.env.NEXT_PUBLIC_BASE_URL}/connections?connected=spotify`);
  res.cookies.delete("spotify_pkce_verifier");
  res.cookies.delete("spotify_state");
  return res;
}
```

**Step 5: Check platform_credentials schema matches**

If `platform_credentials` has different column names, adjust the INSERT above to match. Look at how Strava does it:
```bash
grep -r "platform_credentials" /Users/gkos/projects/soma/.worktrees/spotify-playlist/web --include="*.ts" -l
```

**Step 6: Build check**

```bash
cd /Users/gkos/projects/soma/.worktrees/spotify-playlist/web && npm run build 2>&1 | tail -20
```
Expected: no TypeScript errors in the two new route files.

**Step 7: Commit**

```bash
git add web/app/api/playlist/spotify/
git commit -m "feat: add Spotify PKCE OAuth auth + callback routes"
```

---

### Task 3: spotify-client.ts — Authenticated Fetch Wrapper

**Files:**
- Create: `web/lib/spotify-client.ts`

**Context:** Every Spotify API call needs a valid token. This wrapper auto-refreshes on expiry (silent refresh). Called by all backend routes.

**Step 1: Write the client**

```typescript
// web/lib/spotify-client.ts
import { sql } from "@/lib/db";

interface SpotifyCredentials {
  access_token: string;
  refresh_token: string;
  expires_at: Date;
}

async function getCredentials(): Promise<SpotifyCredentials | null> {
  const rows = await sql`
    SELECT access_token, refresh_token, expires_at
    FROM platform_credentials WHERE platform = 'spotify'
  `;
  return rows[0] ?? null;
}

async function refreshToken(refreshToken: string): Promise<string> {
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: process.env.SPOTIFY_CLIENT_ID!,
    }),
  });

  if (!res.ok) throw new Error("Spotify token refresh failed");

  const data = await res.json();
  const expiresAt = new Date(Date.now() + data.expires_in * 1000);

  await sql`
    UPDATE platform_credentials
    SET access_token = ${data.access_token},
        expires_at = ${expiresAt}
        ${data.refresh_token ? sql`, refresh_token = ${data.refresh_token}` : sql``}
    WHERE platform = 'spotify'
  `;

  return data.access_token;
}

export async function spotifyFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const creds = await getCredentials();
  if (!creds) throw new Error("Spotify not connected");

  let token = creds.access_token;

  // Refresh if expires within 60 seconds
  if (new Date(creds.expires_at).getTime() - Date.now() < 60_000) {
    token = await refreshToken(creds.refresh_token);
  }

  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  // Retry once on 401 (token may have been invalidated mid-request)
  if (res.status === 401) {
    const newToken = await refreshToken(creds.refresh_token);
    return fetch(`https://api.spotify.com/v1${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${newToken}`,
        "Content-Type": "application/json",
        ...(options.headers ?? {}),
      },
    });
  }

  return res;
}

export async function isSpotifyConnected(): Promise<boolean> {
  const creds = await getCredentials();
  return creds !== null;
}

export async function getSpotifyProfile(): Promise<{ id: string; display_name: string } | null> {
  try {
    const res = await spotifyFetch("/me");
    if (!res.ok) return null;
    const data = await res.json();
    return { id: data.id, display_name: data.display_name };
  } catch {
    return null;
  }
}
```

**Step 2: Build check**

```bash
cd /Users/gkos/projects/soma/.worktrees/spotify-playlist/web && npm run build 2>&1 | grep -E "error|Error" | head -20
```

**Step 3: Commit**

```bash
git add web/lib/spotify-client.ts
git commit -m "feat: add spotify-client.ts with silent token refresh"
```

---

### Task 4: reccobeats-client.ts + lastfm-client.ts + genre-mapper.ts

**Files:**
- Create: `web/lib/reccobeats-client.ts`
- Create: `web/lib/lastfm-client.ts`
- Create: `web/lib/genre-mapper.ts`

**Step 1: Write reccobeats-client.ts**

```typescript
// web/lib/reccobeats-client.ts
export interface ReccoBeatsFeatures {
  id: string; tempo: number; energy: number; valence: number; danceability: number; key: number; mode: number;
}

async function fetchBatch(ids: string[]): Promise<ReccoBeatsFeatures[]> {
  if (ids.length === 0) return [];
  const res = await fetch(`https://api.reccobeats.com/v1/audio-features?ids=${ids.join(",")}`);
  if (!res.ok) throw new Error(`ReccoBeats error: ${res.status}`);
  const data = await res.json();
  return (data?.data?.content ?? []) as ReccoBeatsFeatures[];
}

export async function fetchAudioFeatures(ids: string[]): Promise<Map<string, ReccoBeatsFeatures>> {
  const result = new Map<string, ReccoBeatsFeatures>();
  for (let i = 0; i < ids.length; i += 100) {
    const features = await fetchBatch(ids.slice(i, i + 100));
    for (const f of features) result.set(f.id, f);
  }
  return result;
}
```

**Step 2: Write lastfm-client.ts (genre fallback)**

```typescript
// web/lib/lastfm-client.ts
export async function getArtistTopTags(artistName: string): Promise<string[]> {
  const key = process.env.LASTFM_API_KEY;
  if (!key) return [];
  const params = new URLSearchParams({ method: "artist.getTopTags", artist: artistName, api_key: key, format: "json", limit: "10" });
  try {
    const res = await fetch(`https://ws.audioscrobbler.com/2.0/?${params}`);
    if (!res.ok) return [];
    const data = await res.json();
    return ((data?.toptags?.tag ?? []) as Array<{ name: string }>).map((t) => t.name.toLowerCase());
  } catch { return []; }
}
```

**Step 3: Write genre-mapper.ts**

```typescript
// web/lib/genre-mapper.ts
const MACRO_MAP: Record<string, string[]> = {
  "Hip-Hop":      ["hip hop","rap","trap","drill","phonk","dark trap","melodic rap","cloud rap","boom bap"],
  "Electronic":   ["house","techno","trance","drum and bass","dnb","edm","dubstep","garage","ambient","lo-fi","synthwave","electro"],
  "Indie":        ["indie pop","indie rock","indie folk","alternative","shoegaze","dream pop","bedroom pop"],
  "Rock":         ["rock","classic rock","hard rock","metal","punk","grunge","post-rock","emo"],
  "R&B/Soul":     ["r&b","soul","funk","neo soul","contemporary r&b"],
  "Latin/Global": ["reggaeton","latin pop","afrobeats","afropop","latin","k-pop","j-pop","dancehall","reggae"],
  "Ambient/Jazz": ["classical","orchestral","jazz","ambient","new age","meditation","piano","instrumental"],
  "Pop":          ["pop","synth-pop","electropop","dance pop","art pop"],
  "Country/Folk": ["country","americana","folk","bluegrass","singer-songwriter","acoustic"],
};

export function toMacroGenres(microGenres: string[]): string[] {
  const result = new Set<string>();
  for (const micro of microGenres) {
    const lc = micro.toLowerCase();
    for (const [macro, patterns] of Object.entries(MACRO_MAP)) {
      if (patterns.some((p) => lc.includes(p))) { result.add(macro); break; }
    }
  }
  return Array.from(result);
}
```

**Step 4: Add to .env.local**

```
LASTFM_API_KEY=your_key_here
```

**Step 5: Build check + commit**

```bash
cd /Users/gkos/projects/soma/.worktrees/spotify-playlist/web && npm run build 2>&1 | grep "error TS" | head -20
git add web/lib/reccobeats-client.ts web/lib/lastfm-client.ts web/lib/genre-mapper.ts
git commit -m "feat: add ReccoBeats, Last.fm clients and genre-mapper"
```

---

### Task 5: Library Ingestion API

**Files:**
- Create: `web/app/api/playlist/spotify/library/route.ts`

**Context:** POST = ingest library from selected Spotify sources (Liked Songs + playlists). Fetches tracks → filters uncached → ReccoBeats batch BPM → artist genres → store. GET = return status counts.

**Step 1: Write the route**

```typescript
// web/app/api/playlist/spotify/library/route.ts
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { spotifyFetch } from "@/lib/spotify-client";
import { fetchAudioFeatures } from "@/lib/reccobeats-client";
import { getArtistTopTags } from "@/lib/lastfm-client";
import { toMacroGenres } from "@/lib/genre-mapper";

async function fetchSourceTracks(sourceId: string) {
  const tracks: any[] = [];
  let url = sourceId === "liked" ? "/me/tracks?limit=50" : `/playlists/${sourceId}/tracks?limit=50`;
  while (url) {
    const res = await spotifyFetch(url);
    if (!res.ok) break;
    const data = await res.json();
    for (const item of (data.items ?? [])) {
      const t = item.track ?? item;
      if (t?.type === "track" && !t.is_local) tracks.push(t);
    }
    url = data.next ? data.next.replace("https://api.spotify.com/v1", "") : null;
  }
  return tracks;
}

export async function POST(req: NextRequest) {
  const { source_ids = ["liked"] } = await req.json();

  // 1. Collect all unique tracks from sources
  const allTracks = new Map<string, any>();
  for (const sid of source_ids) {
    for (const t of await fetchSourceTracks(sid)) allTracks.set(t.id, t);
  }
  const allIds = Array.from(allTracks.keys());
  if (allIds.length === 0) return NextResponse.json({ cached: 0, new: 0 });

  // 2. Filter already-cached
  const existing = await sql`SELECT track_id FROM spotify_track_features WHERE track_id = ANY(${allIds})`;
  const existingSet = new Set(existing.map((r: any) => r.track_id));
  const newIds = allIds.filter((id) => !existingSet.has(id));
  if (newIds.length === 0) return NextResponse.json({ cached: allIds.length, new: 0 });

  // 3. Batch BPM from ReccoBeats
  const features = await fetchAudioFeatures(newIds);

  // 4. Collect + cache artist genres
  const artistIds = new Set<string>(newIds.map((id) => allTracks.get(id)?.artists?.[0]?.id).filter(Boolean));
  const cachedArtists = await sql`SELECT artist_id FROM spotify_artist_genres WHERE artist_id = ANY(${Array.from(artistIds)})`;
  const cachedArtistSet = new Set(cachedArtists.map((r: any) => r.artist_id));

  for (const artistId of artistIds) {
    if (cachedArtistSet.has(artistId)) continue;
    const res = await spotifyFetch(`/artists/${artistId}`);
    if (!res.ok) continue;
    const artist = await res.json();
    let genres: string[] = artist.genres ?? [];
    let source = "spotify";
    if (genres.length === 0) { genres = await getArtistTopTags(artist.name); source = "lastfm"; }
    const macroGenres = toMacroGenres(genres);
    await sql`INSERT INTO spotify_artist_genres (artist_id, artist_name, genres, macro_genres, source) VALUES (${artistId}, ${artist.name}, ${genres}, ${macroGenres}, ${source}) ON CONFLICT (artist_id) DO NOTHING`;
  }

  // 5. Resolve artist genre map
  const genreRows = await sql`SELECT artist_id, macro_genres FROM spotify_artist_genres WHERE artist_id = ANY(${Array.from(artistIds)})`;
  const genreMap = new Map(genreRows.map((r: any) => [r.artist_id, r.macro_genres]));

  // 6. Insert track features
  let inserted = 0;
  for (const id of newIds) {
    const t = allTracks.get(id);
    const f = features.get(id);
    const artistId = t?.artists?.[0]?.id ?? "";
    const macroGenres = genreMap.get(artistId) ?? [];
    await sql`
      INSERT INTO spotify_track_features (track_id, name, artist_id, artist_name, duration_ms, tempo, energy, valence, danceability, genres)
      VALUES (${id}, ${t.name}, ${artistId}, ${t?.artists?.[0]?.name ?? ""}, ${t.duration_ms}, ${f?.tempo ?? null}, ${f?.energy ?? null}, ${f?.valence ?? null}, ${f?.danceability ?? null}, ${macroGenres})
      ON CONFLICT (track_id) DO UPDATE SET tempo=EXCLUDED.tempo, energy=EXCLUDED.energy, valence=EXCLUDED.valence, genres=EXCLUDED.genres
    `;
    inserted++;
  }
  return NextResponse.json({ cached: existingSet.size, new: inserted });
}

export async function GET() {
  const rows = await sql`SELECT COUNT(*) FILTER (WHERE tempo IS NOT NULL) AS tracks_with_bpm, COUNT(*) AS total_tracks FROM spotify_track_features`;
  return NextResponse.json(rows[0]);
}
```

**Step 2: Build check + commit**

```bash
cd /Users/gkos/projects/soma/.worktrees/spotify-playlist/web && npm run build 2>&1 | grep "error TS" | head -20
git add web/app/api/playlist/spotify/library/
git commit -m "feat: add Spotify library ingestion API"
```

---

### Task 6: GH Actions Cron + Remaining Backend APIs

**Files:**
- Create: `.github/workflows/spotify-library-refresh.yml`
- Create: `web/app/api/playlist/tracks/route.ts`
- Create: `web/app/api/playlist/genres/route.ts`
- Create: `web/app/api/playlist/preferences/route.ts`
- Create: `web/app/api/playlist/sessions/route.ts`
- Create: `web/app/api/playlist/sessions/[id]/route.ts`
- Create: `web/app/api/playlist/workout-plans/route.ts`
- Create: `web/app/api/playlist/pump-up/route.ts`
- Create: `web/app/api/playlist/pump-up/[id]/route.ts`
- Create: `web/app/api/playlist/blacklist/route.ts`
- Create: `web/app/api/playlist/spotify/playlists/route.ts`
- Create: `web/app/api/playlist/spotify/create/route.ts`
- Create: `web/app/api/playlist/garmin-runs/route.ts`
- Create: `web/lib/garmin-lap-parser.ts`

**Step 1: GH Actions workflow**

```yaml
# .github/workflows/spotify-library-refresh.yml
name: Spotify Library Refresh
on:
  schedule: [{ cron: "0 8 * * *" }]
  workflow_dispatch:
jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger library refresh
        run: |
          curl -s -X POST \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
            -H "Content-Type: application/json" \
            -d '{"source_ids":["liked"]}' \
            "${{ secrets.NEXT_PUBLIC_BASE_URL }}/api/playlist/spotify/library"
```

Add to `.env.local`: `CRON_SECRET=some-random-string`

**Step 2: tracks route — query track pool**

```typescript
// web/app/api/playlist/tracks/route.ts
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const bpmMin = parseFloat(sp.get("bpm_min") ?? "0");
  const bpmMax = parseFloat(sp.get("bpm_max") ?? "300");
  const bpmTol = parseFloat(sp.get("bpm_tol") ?? "8");
  const energyMin = parseFloat(sp.get("energy_min") ?? "0");
  const valenceMin = parseFloat(sp.get("valence_min") ?? "0");
  const valenceMax = parseFloat(sp.get("valence_max") ?? "1");
  const genres = sp.get("genres")?.split(",").filter(Boolean) ?? [];
  const halfTime = sp.get("half_time") === "true";
  const excludeIds = sp.get("exclude")?.split(",").filter(Boolean) ?? [];

  const effectiveBpmMin = bpmMin - bpmTol;
  const effectiveBpmMax = bpmMax + bpmTol;

  let rows;
  if (halfTime) {
    rows = await sql`
      SELECT * FROM spotify_track_features
      WHERE (
        (tempo BETWEEN ${effectiveBpmMin} AND ${effectiveBpmMax})
        OR (tempo BETWEEN ${effectiveBpmMin / 2} AND ${effectiveBpmMax / 2})
      )
      AND energy >= ${energyMin}
      AND valence BETWEEN ${valenceMin} AND ${valenceMax}
      ${genres.length > 0 ? sql`AND genres && ${genres}` : sql``}
      ${excludeIds.length > 0 ? sql`AND track_id != ALL(${excludeIds})` : sql``}
      AND track_id NOT IN (SELECT track_id FROM user_blacklist)
      ORDER BY tempo
      LIMIT 500
    `;
  } else {
    rows = await sql`
      SELECT * FROM spotify_track_features
      WHERE tempo BETWEEN ${effectiveBpmMin} AND ${effectiveBpmMax}
      AND energy >= ${energyMin}
      AND valence BETWEEN ${valenceMin} AND ${valenceMax}
      ${genres.length > 0 ? sql`AND genres && ${genres}` : sql``}
      ${excludeIds.length > 0 ? sql`AND track_id != ALL(${excludeIds})` : sql``}
      AND track_id NOT IN (SELECT track_id FROM user_blacklist)
      ORDER BY tempo
      LIMIT 500
    `;
  }
  return NextResponse.json(rows);
}
```

**Step 3: genres route**

```typescript
// web/app/api/playlist/genres/route.ts
import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export async function GET() {
  const rows = await sql`
    SELECT unnest(genres) AS genre, COUNT(*) AS count
    FROM spotify_track_features
    GROUP BY genre
    ORDER BY count DESC
  `;
  const total = rows.reduce((s: number, r: any) => s + parseInt(r.count), 0);
  return NextResponse.json({ genres: rows, total });
}
```

**Step 4: preferences route**

```typescript
// web/app/api/playlist/preferences/route.ts
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export async function GET() {
  const rows = await sql`SELECT * FROM playlist_preferences ORDER BY segment_type`;
  return NextResponse.json(rows);
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { segment_type, ...fields } = body;
  await sql`
    INSERT INTO playlist_preferences (segment_type, sync_mode, bpm_min, bpm_max, bpm_tolerance, valence_min, valence_max)
    VALUES (${segment_type}, ${fields.sync_mode ?? "auto"}, ${fields.bpm_min ?? null}, ${fields.bpm_max ?? null}, ${fields.bpm_tolerance ?? 8}, ${fields.valence_min ?? null}, ${fields.valence_max ?? null})
    ON CONFLICT (segment_type) DO UPDATE SET
      sync_mode = EXCLUDED.sync_mode, bpm_min = EXCLUDED.bpm_min, bpm_max = EXCLUDED.bpm_max,
      bpm_tolerance = EXCLUDED.bpm_tolerance, valence_min = EXCLUDED.valence_min, valence_max = EXCLUDED.valence_max,
      updated_at = NOW()
  `;
  return NextResponse.json({ ok: true });
}
```

**Step 5: workout-plans route**

```typescript
// web/app/api/playlist/workout-plans/route.ts
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export async function GET() {
  const rows = await sql`SELECT * FROM workout_plans ORDER BY created_at DESC`;
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const totalDuration = (body.segments ?? []).reduce((s: number, seg: any) => s + (seg.duration_s ?? 0), 0);
  const [row] = await sql`
    INSERT INTO workout_plans (name, description, sport_type, segments, total_duration_s, source, garmin_activity_id)
    VALUES (${body.name}, ${body.description ?? null}, ${body.sport_type ?? "running"}, ${body.segments}, ${totalDuration}, ${body.source ?? "manual"}, ${body.garmin_activity_id ?? null})
    RETURNING *
  `;
  return NextResponse.json(row);
}
```

**Step 6: sessions route (with SSE streaming algorithm)**

```typescript
// web/app/api/playlist/sessions/route.ts
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { selectSongsForSegment, qualityScore, pickSkipSong, isHalfTimeMatch, SongCandidate } from "@/lib/playlist-algorithm";

export async function GET() {
  const rows = await sql`SELECT * FROM playlist_sessions ORDER BY created_at DESC LIMIT 50`;
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { segments, excluded_track_ids = [], genre_selection = [], genre_threshold = 0.03, source_playlist_ids = [], workout_plan_id, garmin_activity_id } = body;

  // Create session record
  const [session] = await sql`
    INSERT INTO playlist_sessions (workout_plan_id, garmin_activity_id, source_playlist_ids, genre_selection, genre_threshold, excluded_track_ids, song_assignments)
    VALUES (${workout_plan_id ?? null}, ${garmin_activity_id ?? null}, ${source_playlist_ids}, ${genre_selection}, ${genre_threshold}, ${excluded_track_ids}, ${{}} )
    RETURNING id
  `;

  // Stream SSE
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);
      };

      const allAssignments: Record<number, any[]> = {};

      for (let idx = 0; idx < segments.length; idx++) {
        const seg = segments[idx];
        send({ type: "segment_start", index: idx });

        // BPM defaults per segment type (see design doc)
        const BPM_DEFAULTS: Record<string, { min: number; max: number; minEnergy: number }> = {
          warmup:   { min: 100, max: 140, minEnergy: 0.4 },
          easy:     { min: 125, max: 145, minEnergy: 0.5 },
          aerobic:  { min: 125, max: 145, minEnergy: 0.6 },
          tempo:    { min: 160, max: 180, minEnergy: 0.75 },
          interval: { min: 175, max: 195, minEnergy: 0.85 },
          vo2max:   { min: 175, max: 195, minEnergy: 0.85 },
          recovery: { min: 125, max: 145, minEnergy: 0.5 },
          rest:     { min: 80,  max: 110, minEnergy: 0.3 },
          strides:  { min: 160, max: 180, minEnergy: 0.75 },
          cooldown: { min: 60,  max: 90,  minEnergy: 0.3 },
        };

        const defaults = BPM_DEFAULTS[seg.type] ?? BPM_DEFAULTS.easy;
        const bpmMin = seg.bpm_min ?? defaults.min;
        const bpmMax = seg.bpm_max ?? defaults.max;
        const bpmTol = seg.bpm_tolerance ?? 8;
        const valenceMin = seg.valence_min ?? 0;
        const valenceMax = seg.valence_max ?? 1;
        const cfg = { bpm_min: bpmMin, bpm_max: bpmMax, bpm_tolerance: bpmTol, min_energy: defaults.minEnergy, valence_min: valenceMin, valence_max: valenceMax, half_time: true };

        // Query track pool
        const rows = await sql`
          SELECT * FROM spotify_track_features
          WHERE (
            (tempo BETWEEN ${bpmMin - bpmTol} AND ${bpmMax + bpmTol})
            OR (tempo BETWEEN ${(bpmMin - bpmTol) / 2} AND ${(bpmMax + bpmTol) / 2})
          )
          AND energy >= ${defaults.minEnergy - 0.2}
          AND valence BETWEEN ${valenceMin} AND ${valenceMax}
          ${genre_selection.length > 0 ? sql`AND genres && ${genre_selection}` : sql``}
          AND track_id != ALL(${[...excluded_track_ids]})
          AND track_id NOT IN (SELECT track_id FROM user_blacklist)
          ORDER BY tempo
          LIMIT 500
        `;

        const alreadyPlaced = new Set(Object.values(allAssignments).flat().map((s: any) => s.track_id));

        const candidates: SongCandidate[] = rows.map((r: any) => ({
          ...r,
          quality_score: qualityScore(r, cfg),
        })).filter((c: SongCandidate) => !alreadyPlaced.has(c.track_id));

        if (candidates.length < 3) {
          send({ type: "segment_warning", index: idx, message: `Only ${candidates.length} songs found`, pool_count: candidates.length });
        }

        // DP: capacity = duration - 60s reserve for skip song
        const capacity = Math.max(0, seg.duration_s - 60);
        const selected = selectSongsForSegment(candidates, capacity);

        const placedIds = new Set([...alreadyPlaced, ...selected.map((s) => s.track_id)]);
        const skipSong = pickSkipSong(candidates, placedIds);

        const segmentSongs = [
          ...selected.map((s) => ({ ...s, is_skip: false, is_half_time: isHalfTimeMatch(s.tempo, cfg) })),
          ...(skipSong ? [{ ...skipSong, is_skip: true, is_half_time: isHalfTimeMatch(skipSong.tempo, cfg) }] : []),
        ];

        allAssignments[idx] = segmentSongs;
        send({ type: "segment_done", index: idx, songs: segmentSongs, pool_count: candidates.length });
      }

      // Save final assignments
      await sql`UPDATE playlist_sessions SET song_assignments = ${allAssignments} WHERE id = ${session.id}`;
      send({ type: "done", session_id: session.id });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
```

**Step 7: sessions/[id] route**

```typescript
// web/app/api/playlist/sessions/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const [row] = await sql`SELECT * FROM playlist_sessions WHERE id = ${params.id}`;
  return row ? NextResponse.json(row) : NextResponse.json(null, { status: 404 });
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const [row] = await sql`
    UPDATE playlist_sessions SET
      song_assignments = COALESCE(${body.song_assignments ?? null}, song_assignments),
      excluded_track_ids = COALESCE(${body.excluded_track_ids ?? null}, excluded_track_ids),
      genre_selection = COALESCE(${body.genre_selection ?? null}, genre_selection),
      updated_at = NOW()
    WHERE id = ${params.id}
    RETURNING *
  `;
  return NextResponse.json(row);
}
```

**Step 8: pump-up routes**

```typescript
// web/app/api/playlist/pump-up/route.ts
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export async function GET() {
  return NextResponse.json(await sql`SELECT * FROM pump_up_songs ORDER BY added_at DESC`);
}

export async function POST(req: NextRequest) {
  const { track_id, name, artist_name, tempo, energy } = await req.json();
  const count = await sql`SELECT COUNT(*) FROM pump_up_songs`;
  if (parseInt((count[0] as any).count) >= 10) {
    return NextResponse.json({ error: "Max 10 pump-up songs" }, { status: 400 });
  }
  await sql`INSERT INTO pump_up_songs (track_id, name, artist_name, tempo, energy) VALUES (${track_id}, ${name}, ${artist_name}, ${tempo ?? null}, ${energy ?? null}) ON CONFLICT (track_id) DO NOTHING`;
  return NextResponse.json({ ok: true });
}
```

```typescript
// web/app/api/playlist/pump-up/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  await sql`DELETE FROM pump_up_songs WHERE track_id = ${params.id}`;
  return NextResponse.json({ ok: true });
}
```

**Step 9: blacklist route**

```typescript
// web/app/api/playlist/blacklist/route.ts
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export async function GET() {
  return NextResponse.json(await sql`SELECT * FROM user_blacklist ORDER BY blacklisted_at DESC`);
}

export async function POST(req: NextRequest) {
  const { track_id, name, artist_name } = await req.json();

  // Increment exclude count
  await sql`
    INSERT INTO track_exclude_counts (track_id, exclude_count)
    VALUES (${track_id}, 1)
    ON CONFLICT (track_id) DO UPDATE SET exclude_count = track_exclude_counts.exclude_count + 1, last_excluded_at = NOW()
  `;

  // Add to permanent blacklist
  await sql`INSERT INTO user_blacklist (track_id, name, artist_name) VALUES (${track_id}, ${name ?? null}, ${artist_name ?? null}) ON CONFLICT (track_id) DO NOTHING`;

  return NextResponse.json({ ok: true });
}
```

**Step 10: Spotify playlists list + create routes**

```typescript
// web/app/api/playlist/spotify/playlists/route.ts
import { NextResponse } from "next/server";
import { spotifyFetch } from "@/lib/spotify-client";

export async function GET() {
  const playlists: any[] = [];
  let url = "/me/playlists?limit=50";
  while (url) {
    const res = await spotifyFetch(url);
    if (!res.ok) break;
    const data = await res.json();
    playlists.push(...(data.items ?? []));
    url = data.next ? data.next.replace("https://api.spotify.com/v1", "") : null;
  }
  return NextResponse.json(playlists.map((p) => ({ id: p.id, name: p.name, tracks: p.tracks?.total })));
}
```

```typescript
// web/app/api/playlist/spotify/create/route.ts
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { spotifyFetch, getSpotifyProfile } from "@/lib/spotify-client";

export async function POST(req: NextRequest) {
  const { session_id, name, track_ids } = await req.json();
  const profile = await getSpotifyProfile();
  if (!profile) return NextResponse.json({ error: "Not connected" }, { status: 401 });

  // Create playlist
  const createRes = await spotifyFetch(`/users/${profile.id}/playlists`, {
    method: "POST",
    body: JSON.stringify({ name, public: false, description: "Generated by Soma" }),
  });
  if (!createRes.ok) return NextResponse.json({ error: "Failed to create playlist" }, { status: 500 });
  const playlist = await createRes.json();

  // Add tracks in batches of 100
  for (let i = 0; i < track_ids.length; i += 100) {
    const batch = track_ids.slice(i, i + 100).map((id: string) => `spotify:track:${id}`);
    await spotifyFetch(`/playlists/${playlist.id}/tracks`, {
      method: "POST",
      body: JSON.stringify({ uris: batch }),
    });
  }

  // Save playlist ID to session
  if (session_id) {
    await sql`UPDATE playlist_sessions SET spotify_playlist_id = ${playlist.id}, spotify_playlist_url = ${playlist.external_urls?.spotify}, updated_at = NOW() WHERE id = ${session_id}`;
  }

  return NextResponse.json({ playlist_id: playlist.id, playlist_url: playlist.external_urls?.spotify });
}
```

**Step 11: Garmin lap parser + garmin-runs API**

`web/lib/garmin-lap-parser.ts`:
```typescript
export interface ParsedSegment {
  index: number;
  type: "warmup"|"easy"|"aerobic"|"tempo"|"interval"|"vo2max"|"recovery"|"rest"|"strides"|"cooldown";
  duration_s: number; distance_m: number; avg_hr: number|null; hr_zone: number|null;
  is_repeat: boolean; repeat_iteration: number; wkt_step_index: number|null;
}

const INTENSITY_MAP: Record<string, ParsedSegment["type"]> = {
  WARMUP: "warmup", INTERVAL: "interval", ACTIVE: "interval",
  RECOVERY: "recovery", REST: "rest", COOLDOWN: "cooldown", EASY: "easy",
};

export function parseStructuredLaps(laps: any[]): ParsedSegment[] {
  const workoutLaps = laps.filter((l) => l.wktStepIndex != null);
  const groups: Array<{idx: number; type: string; laps: any[]}> = [];
  for (const lap of workoutLaps) {
    const last = groups[groups.length - 1];
    if (last && last.idx === lap.wktStepIndex && last.type === lap.intensityType) last.laps.push(lap);
    else groups.push({ idx: lap.wktStepIndex, type: lap.intensityType, laps: [lap] });
  }
  const seen = new Map<number, number>();
  return groups.map((g, i) => {
    const prev = seen.get(g.idx) ?? 0; seen.set(g.idx, prev + 1);
    const dur = g.laps.reduce((s, l) => s + (l.duration ?? 0), 0);
    const dist = g.laps.reduce((s, l) => s + (l.distance ?? 0), 0);
    const hr = g.laps.reduce((s, l) => s + (l.averageHR ?? 0), 0) / g.laps.length || null;
    return { index: i, type: INTENSITY_MAP[g.type?.toUpperCase()] ?? "easy", duration_s: Math.round(dur), distance_m: Math.round(dist), avg_hr: hr ? Math.round(hr) : null, hr_zone: null, is_repeat: prev > 0, repeat_iteration: prev, wkt_step_index: g.idx };
  });
}

export function parseUnstructuredLaps(laps: any[], zones = [0,114,133,152,171,999]): ParsedSegment[] {
  const getZone = (hr: number) => { for (let i = zones.length-2; i >= 0; i--) if (hr >= zones[i]) return i+1; return 1; };
  const hrZoneToType = (z: number): ParsedSegment["type"] => (["easy","easy","aerobic","tempo","interval","vo2max"] as const)[Math.min(z, 5)];
  const smoothed = laps.map((l, i) => { const w = laps.slice(Math.max(0,i-1),i+2); return { ...l, sHR: w.reduce((s,x)=>s+(x.averageHR??0),0)/w.length }; });
  const groups: Array<{zone: number; laps: typeof smoothed}> = [];
  for (const l of smoothed) { const z = getZone(l.sHR); const last = groups[groups.length-1]; if (last && last.zone === z) last.laps.push(l); else groups.push({ zone: z, laps: [l] }); }
  return groups.map((g, i) => ({ index: i, type: hrZoneToType(g.zone), duration_s: Math.round(g.laps.reduce((s,l)=>s+(l.duration??0),0)), distance_m: Math.round(g.laps.reduce((s,l)=>s+(l.distance??0),0)), avg_hr: Math.round(g.laps.reduce((s,l)=>s+(l.averageHR??0),0)/g.laps.length)||null, hr_zone: g.zone, is_repeat: false, repeat_iteration: 0, wkt_step_index: null }));
}
```

`web/app/api/playlist/garmin-runs/route.ts`:
```typescript
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { parseStructuredLaps, parseUnstructuredLaps } from "@/lib/garmin-lap-parser";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const id = sp.get("id");
  const limit = parseInt(sp.get("limit") ?? "50");
  const q = sp.get("q") ?? "";

  if (id) {
    const [row] = await sql`SELECT * FROM garmin_activity_raw WHERE activity_id = ${id} AND endpoint_name = 'splits' LIMIT 1`;
    if (!row) return NextResponse.json(null);
    const laps = (row as any).data?.lapDTOs ?? [];
    const hasSplits = (row as any).data?.activityDetail?.hasSplits ?? false;
    const segs = hasSplits ? parseStructuredLaps(laps) : parseUnstructuredLaps(laps);
    const isTreadmill = laps.length > 0 && laps[0].startLatitude == null;
    return NextResponse.json({ ...row, segments: segs, hasSplits, isTreadmill });
  }

  const rows = await sql`
    SELECT DISTINCT ON (activity_id) activity_id, activity_name, start_time, distance, duration, sport_type
    FROM garmin_activity_raw
    WHERE endpoint_name = 'splits' AND sport_type ILIKE '%running%'
      AND (${q} = '' OR activity_name ILIKE ${"%" + q + "%"})
    ORDER BY activity_id, start_time DESC
    LIMIT ${limit}
  `;
  return NextResponse.json(rows);
}
```

**Step 12: Build check all routes + commit**

```bash
cd /Users/gkos/projects/soma/.worktrees/spotify-playlist/web && npm run build 2>&1 | grep "error TS" | head -30
git add web/app/api/playlist/ web/lib/garmin-lap-parser.ts web/lib/playlist-algorithm.ts .github/workflows/
git commit -m "feat: add all backend playlist APIs + garmin parser + DP algorithm"
```

---

## Phase 3: UI Foundation

### Task 9: Page Shell + Onboarding

**Files:**
- Create: `web/app/playlist/page.tsx`
- Create: `web/app/playlist/playlist-client.tsx`
- Create: `web/components/playlist-onboarding.tsx`

**Step 1: Server component — check Spotify connection**

```typescript
// web/app/playlist/page.tsx
import { isSpotifyConnected } from "@/lib/spotify-client";
import PlaylistClient from "./playlist-client";

export default async function PlaylistPage() {
  const connected = await isSpotifyConnected();
  return <PlaylistClient spotifyConnected={connected} />;
}
```

**Step 2: Client root with Framer Motion layout provider**

```typescript
// web/app/playlist/playlist-client.tsx
"use client";
import { motion, AnimatePresence } from "framer-motion";
import PlaylistOnboarding from "@/components/playlist-onboarding";
import PlaylistBuilder from "@/components/playlist-builder";
import { useState, useEffect } from "react";

interface Props { spotifyConnected: boolean; }

export default function PlaylistClient({ spotifyConnected }: Props) {
  const [libraryAnalysed, setLibraryAnalysed] = useState(false);
  const [runSelected, setRunSelected] = useState(false);

  // Check library status on mount
  useEffect(() => {
    fetch("/api/playlist/spotify/library")
      .then(r => r.json())
      .then(d => { if (d.tracks_with_bpm > 0) setLibraryAnalysed(true); })
      .catch(() => {});
  }, []);

  const isReady = spotifyConnected && libraryAnalysed && runSelected;

  return (
    <div className="flex flex-col h-full">
      <AnimatePresence mode="wait">
        {!isReady ? (
          <motion.div key="onboarding" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
            <PlaylistOnboarding
              spotifyConnected={spotifyConnected}
              libraryAnalysed={libraryAnalysed}
              onLibraryAnalysed={() => setLibraryAnalysed(true)}
              onRunSelected={() => setRunSelected(true)}
            />
          </motion.div>
        ) : (
          <motion.div key="builder" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} className="flex-1">
            <PlaylistBuilder />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
```

**Step 3: Onboarding component (stepped checklist)**

```typescript
// web/components/playlist-onboarding.tsx
"use client";
import { motion, AnimatePresence } from "framer-motion";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

interface Props {
  spotifyConnected: boolean;
  libraryAnalysed: boolean;
  onLibraryAnalysed: () => void;
  onRunSelected: () => void;
}

export default function PlaylistOnboarding({ spotifyConnected, libraryAnalysed, onLibraryAnalysed, onRunSelected }: Props) {
  const [analysing, setAnalysing] = useState(false);

  async function handleAnalyse() {
    setAnalysing(true);
    await fetch("/api/playlist/spotify/library", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_ids: ["liked"] }),
    });
    setAnalysing(false);
    onLibraryAnalysed();
  }

  const steps = [
    {
      n: 1, label: "Connect Spotify", done: spotifyConnected,
      action: <Button asChild size="sm"><a href="/api/playlist/spotify/auth">Connect →</a></Button>,
    },
    {
      n: 2, label: "Analyse your library", done: libraryAnalysed, locked: !spotifyConnected,
      action: <Button size="sm" onClick={handleAnalyse} disabled={analysing}>{analysing ? "Analysing…" : "Analyse Library"}</Button>,
    },
    {
      n: 3, label: "Pick a run", done: false, locked: !libraryAnalysed,
      action: <Button size="sm" onClick={onRunSelected}>Pick Run →</Button>,
    },
  ];

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 p-8">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold">Playlist Builder</h1>
        <p className="text-muted-foreground text-sm">Build BPM-matched running playlists from your Spotify library</p>
      </div>
      <div className="w-full max-w-sm space-y-3">
        {steps.map((step) => (
          <motion.div
            key={step.n}
            layout
            animate={{ opacity: step.locked ? 0.4 : 1 }}
            className="flex items-center gap-4 p-4 rounded-lg border bg-card"
          >
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${step.done ? "bg-primary text-primary-foreground" : "border-2 border-muted-foreground text-muted-foreground"}`}>
              {step.done ? (
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 400, damping: 20 }}>
                  <Check className="w-4 h-4" />
                </motion.div>
              ) : step.n}
            </div>
            <span className="flex-1 text-sm font-medium">{step.label}</span>
            {!step.done && !step.locked && step.action}
          </motion.div>
        ))}
      </div>
    </div>
  );
}
```

**Step 4: Add playlist to sidebar navigation**

Find the sidebar nav component (check `web/components/nav*.tsx` or `web/components/sidebar*.tsx`):
```bash
grep -r "href.*running\|href.*sleep\|href.*workout" /Users/gkos/projects/soma/.worktrees/spotify-playlist/web/components --include="*.tsx" -l | head -5
```
Add `{ href: "/playlist", label: "Playlist", icon: Music2 }` to the nav items array.

**Step 5: Build check + commit**

```bash
cd /Users/gkos/projects/soma/.worktrees/spotify-playlist/web && npm run build 2>&1 | grep "error TS" | head -20
git add web/app/playlist/ web/components/playlist-onboarding.tsx web/components/
git commit -m "feat: add playlist page shell + stepped onboarding"
```

---

### Task 10: Top Bar + Run Selector (4 Tabs)

**Files:**
- Create: `web/components/playlist-top-bar.tsx`
- Create: `web/components/playlist-source-picker.tsx`
- Create: `web/components/playlist-genre-picker.tsx`
- Create: `web/components/playlist-run-selector.tsx`

**Step 1: Top bar with compact dropdowns**

```typescript
// web/components/playlist-top-bar.tsx
"use client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ChevronDown } from "lucide-react";
import PlaylistSourcePicker from "./playlist-source-picker";
import PlaylistGenrePicker from "./playlist-genre-picker";

interface Props {
  sources: string[];
  onSourcesChange: (v: string[]) => void;
  genres: string[];
  onGenresChange: (v: string[]) => void;
  genreThreshold: number;
  onThresholdChange: (v: number) => void;
  workoutName?: string;
}

export default function PlaylistTopBar({ sources, onSourcesChange, genres, onGenresChange, genreThreshold, onThresholdChange, workoutName }: Props) {
  return (
    <div className="sticky top-0 z-10 flex items-center gap-2 p-2 border-b bg-background/80 backdrop-blur-sm">
      <span className="text-sm font-medium truncate max-w-[160px]">{workoutName ?? "Pick a run ▾"}</span>
      <div className="flex-1" />
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
            Sources <span className="text-muted-foreground">({sources.length})</span> <ChevronDown className="w-3 h-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-3">
          <PlaylistSourcePicker selected={sources} onChange={onSourcesChange} />
        </PopoverContent>
      </Popover>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
            Genres <span className="text-muted-foreground">({genres.length})</span> <ChevronDown className="w-3 h-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-3">
          <PlaylistGenrePicker selected={genres} onChange={onGenresChange} threshold={genreThreshold} onThresholdChange={onThresholdChange} />
        </PopoverContent>
      </Popover>
    </div>
  );
}
```

**Step 2: Source picker**

```typescript
// web/components/playlist-source-picker.tsx
"use client";
import { useEffect, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";

interface SpotifyPlaylist { id: string; name: string; tracks: number; }

interface Props {
  selected: string[];
  onChange: (v: string[]) => void;
}

export default function PlaylistSourcePicker({ selected, onChange }: Props) {
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([]);
  const [libraryStatus, setLibraryStatus] = useState<{total_tracks: number; tracks_with_bpm: number} | null>(null);
  const [analysing, setAnalysing] = useState(false);

  useEffect(() => {
    fetch("/api/playlist/spotify/playlists").then(r => r.json()).then(setPlaylists).catch(() => {});
    fetch("/api/playlist/spotify/library").then(r => r.json()).then(setLibraryStatus).catch(() => {});
  }, []);

  const sources = [{ id: "liked", name: "Liked Songs", tracks: libraryStatus?.total_tracks }, ...playlists];

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter(s => s !== id) : [...selected, id]);
  }

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-muted-foreground mb-2">Select music sources</div>
      <div className="max-h-60 overflow-y-auto space-y-1">
        {sources.map(s => (
          <label key={s.id} className="flex items-center gap-2 p-1.5 rounded hover:bg-muted cursor-pointer">
            <Checkbox checked={selected.includes(s.id)} onCheckedChange={() => toggle(s.id)} />
            <span className="text-sm flex-1">{s.name}</span>
            {s.tracks && <span className="text-xs text-muted-foreground">{s.tracks}</span>}
          </label>
        ))}
      </div>
      <Button size="sm" className="w-full mt-2" disabled={analysing} onClick={async () => {
        setAnalysing(true);
        await fetch("/api/playlist/spotify/library", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ source_ids: selected }) });
        const status = await fetch("/api/playlist/spotify/library").then(r => r.json());
        setLibraryStatus(status);
        setAnalysing(false);
      }}>
        {analysing ? "Analysing…" : "Analyse Library"}
      </Button>
      {libraryStatus && (
        <div className="text-xs text-muted-foreground text-center">
          {libraryStatus.tracks_with_bpm} / {libraryStatus.total_tracks} tracks analysed
        </div>
      )}
    </div>
  );
}
```

**Step 3: Genre picker**

```typescript
// web/components/playlist-genre-picker.tsx
"use client";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Slider } from "@/components/ui/slider";

interface Props {
  selected: string[];
  onChange: (v: string[]) => void;
  threshold: number;
  onThresholdChange: (v: number) => void;
}

export default function PlaylistGenrePicker({ selected, onChange, threshold, onThresholdChange }: Props) {
  const [genres, setGenres] = useState<Array<{genre: string; count: number}>>([]);
  const [total, setTotal] = useState(1);

  useEffect(() => {
    fetch("/api/playlist/genres").then(r => r.json()).then(d => { setGenres(d.genres ?? []); setTotal(d.total ?? 1); }).catch(() => {});
  }, []);

  const visible = genres.filter(g => g.count / total >= threshold);

  function toggle(genre: string) {
    onChange(selected.includes(genre) ? selected.filter(g => g !== genre) : [...selected, genre]);
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Min frequency</span><span>{(threshold * 100).toFixed(0)}%</span>
        </div>
        <Slider min={1} max={10} step={1} value={[threshold * 100]} onValueChange={([v]) => onThresholdChange(v / 100)} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        <AnimatePresence>
          {visible.map(g => (
            <motion.button
              key={g.genre}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              onClick={() => toggle(g.genre)}
              className={`px-2 py-0.5 rounded-full text-xs border transition-colors ${selected.includes(g.genre) ? "bg-primary text-primary-foreground border-primary" : "bg-muted border-muted-foreground/20 hover:border-primary"}`}
            >
              {g.genre} · {g.count}
            </motion.button>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
```

**Step 4: Run selector (4 tabs)**

```typescript
// web/components/playlist-run-selector.tsx
"use client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { useState, useEffect } from "react";
import { formatDistanceToNow } from "date-fns";

interface GarminRun { activity_id: string; activity_name: string; start_time: string; distance: number; duration: number; }
interface Session { id: number; created_at: string; garmin_activity_id: string; spotify_playlist_url: string; }

interface Props {
  onSelect: (run: { type: "garmin" | "plan" | "session"; data: any; segments: any[] }) => void;
}

export default function PlaylistRunSelector({ onSelect }: Props) {
  const [garminRuns, setGarminRuns] = useState<GarminRun[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch(`/api/playlist/garmin-runs?limit=50&q=${encodeURIComponent(search)}`).then(r => r.json()).then(setGarminRuns).catch(() => {});
  }, [search]);

  useEffect(() => {
    fetch("/api/playlist/sessions").then(r => r.json()).then(setSessions).catch(() => {});
  }, []);

  async function selectGarminRun(run: GarminRun) {
    const data = await fetch(`/api/playlist/garmin-runs?id=${run.activity_id}`).then(r => r.json());
    onSelect({ type: "garmin", data: run, segments: data.segments ?? [] });
  }

  return (
    <div className="h-full flex flex-col">
      <Tabs defaultValue="past" className="flex-1 flex flex-col">
        <TabsList className="mx-3 mt-2 shrink-0">
          <TabsTrigger value="past" className="text-xs">Past Runs</TabsTrigger>
          <TabsTrigger value="plans" className="text-xs">Saved Plans</TabsTrigger>
          <TabsTrigger value="manual" className="text-xs">Manual</TabsTrigger>
          <TabsTrigger value="history" className="text-xs">History</TabsTrigger>
        </TabsList>

        <TabsContent value="past" className="flex-1 overflow-hidden flex flex-col px-3 pb-3">
          <Input placeholder="Search runs…" value={search} onChange={e => setSearch(e.target.value)} className="my-2 h-7 text-xs" />
          <div className="flex-1 overflow-y-auto space-y-1">
            {garminRuns.map(run => (
              <button key={run.activity_id} onClick={() => selectGarminRun(run)}
                className="w-full text-left p-2.5 rounded-lg border hover:bg-muted transition-colors">
                <div className="text-sm font-medium truncate">{run.activity_name}</div>
                <div className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(run.start_time), { addSuffix: true })} · {(run.distance / 1000).toFixed(1)} km · {Math.round(run.duration / 60)} min
                </div>
              </button>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="history" className="flex-1 overflow-y-auto px-3 pb-3 space-y-1">
          {sessions.map(s => (
            <button key={s.id} onClick={async () => {
              const data = await fetch(`/api/playlist/sessions/${s.id}`).then(r => r.json());
              onSelect({ type: "session", data: s, segments: [] });
            }} className="w-full text-left p-2.5 rounded-lg border hover:bg-muted transition-colors">
              <div className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(s.created_at), { addSuffix: true })}</div>
              {s.spotify_playlist_url && <a href={s.spotify_playlist_url} target="_blank" className="text-xs text-primary hover:underline" onClick={e => e.stopPropagation()}>Open in Spotify ↗</a>}
            </button>
          ))}
        </TabsContent>

        <TabsContent value="plans" className="px-3 pb-3">
          <div className="text-xs text-muted-foreground pt-4 text-center">No saved plans yet</div>
        </TabsContent>

        <TabsContent value="manual" className="px-3 pb-3">
          <div className="text-xs text-muted-foreground pt-4 text-center">Manual builder — coming soon</div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

**Step 5: Build check + commit**

```bash
cd /Users/gkos/projects/soma/.worktrees/spotify-playlist/web && npm run build 2>&1 | grep "error TS" | head -20
git add web/components/playlist-top-bar.tsx web/components/playlist-source-picker.tsx web/components/playlist-genre-picker.tsx web/components/playlist-run-selector.tsx
git commit -m "feat: add playlist top bar, source/genre pickers, run selector"
```

---

## Phase 4: Core Builder UI

### Task 11: Segment Timeline (Left Panel)

**Files:**
- Create: `web/components/run-segment-timeline.tsx`
- Create: `web/components/segment-editor.tsx`

**Step 1: segment-editor.tsx — inline editor with all fields**

```typescript
// web/components/segment-editor.tsx
"use client";
import { motion } from "framer-motion";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const SEGMENT_TYPES = ["warmup","easy","aerobic","tempo","interval","vo2max","recovery","rest","strides","cooldown"] as const;
type SegmentType = typeof SEGMENT_TYPES[number];

const TYPE_COLORS: Record<SegmentType, string> = {
  warmup: "bg-yellow-500", easy: "bg-green-500", aerobic: "bg-blue-500",
  tempo: "bg-orange-500", interval: "bg-red-500", vo2max: "bg-purple-500",
  recovery: "bg-sky-400", rest: "bg-slate-400", strides: "bg-amber-400", cooldown: "bg-slate-600",
};

export interface Segment {
  id: string; type: SegmentType; duration_s: number;
  bpm_min: number; bpm_max: number; bpm_tolerance: number;
  sync_mode: "sync" | "async" | "auto";
  valence_min: number; valence_max: number;
}

interface Props {
  segment: Segment;
  onChange: (s: Segment) => void;
}

export default function SegmentEditor({ segment, onChange }: Props) {
  const mins = Math.floor(segment.duration_s / 60);
  const secs = segment.duration_s % 60;

  function update(patch: Partial<Segment>) {
    onChange({ ...segment, ...patch });
  }

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="overflow-hidden"
    >
      <div className="p-3 space-y-3 bg-muted/30 rounded-b-lg border-x border-b">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Type</Label>
            <Select value={segment.type} onValueChange={(v) => update({ type: v as SegmentType })}>
              <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SEGMENT_TYPES.map(t => <SelectItem key={t} value={t} className="text-xs capitalize">{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Duration</Label>
            <div className="flex gap-1 mt-1">
              <Input type="number" value={mins} min={0} className="h-8 text-xs w-16"
                onChange={e => update({ duration_s: parseInt(e.target.value || "0") * 60 + secs })} />
              <span className="text-xs self-center text-muted-foreground">min</span>
              <Input type="number" value={secs} min={0} max={59} className="h-8 text-xs w-16"
                onChange={e => update({ duration_s: mins * 60 + parseInt(e.target.value || "0") })} />
              <span className="text-xs self-center text-muted-foreground">sec</span>
            </div>
          </div>
        </div>

        <div>
          <Label className="text-xs">BPM Range</Label>
          <div className="flex gap-2 items-center mt-1">
            <Input type="number" value={segment.bpm_min} className="h-8 text-xs w-16" onChange={e => update({ bpm_min: parseInt(e.target.value) })} />
            <span className="text-xs text-muted-foreground">–</span>
            <Input type="number" value={segment.bpm_max} className="h-8 text-xs w-16" onChange={e => update({ bpm_max: parseInt(e.target.value) })} />
            <span className="text-xs text-muted-foreground">±</span>
            <Input type="number" value={segment.bpm_tolerance} className="h-8 text-xs w-14" onChange={e => update({ bpm_tolerance: parseInt(e.target.value) })} />
          </div>
        </div>

        <div>
          <div className="flex justify-between">
            <Label className="text-xs">Valence (mood)</Label>
            <span className="text-xs text-muted-foreground">{segment.valence_min.toFixed(1)} – {segment.valence_max.toFixed(1)}</span>
          </div>
          <Slider
            min={0} max={1} step={0.1}
            value={[segment.valence_min, segment.valence_max]}
            onValueChange={([min, max]) => update({ valence_min: min, valence_max: max })}
            className="mt-2"
          />
        </div>

        <div>
          <Label className="text-xs">Sync mode</Label>
          <div className="flex gap-2 mt-1">
            {(["auto","sync","async"] as const).map(m => (
              <button key={m} onClick={() => update({ sync_mode: m })}
                className={`px-2 py-0.5 rounded text-xs border transition-colors ${segment.sync_mode === m ? "bg-primary text-primary-foreground border-primary" : "hover:border-primary"}`}>
                {m}
              </button>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
```

**Step 2: run-segment-timeline.tsx**

```typescript
// web/components/run-segment-timeline.tsx
"use client";
import { motion, AnimatePresence, Reorder } from "framer-motion";
import { Plus, GripVertical, Trash2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import SegmentEditor, { Segment } from "./segment-editor";
import { useState } from "react";
import { nanoid } from "nanoid";

const TYPE_COLORS: Record<string, string> = {
  warmup: "bg-yellow-500", easy: "bg-green-500", aerobic: "bg-blue-500",
  tempo: "bg-orange-500", interval: "bg-red-500", vo2max: "bg-purple-500",
  recovery: "bg-sky-400", rest: "bg-slate-400", strides: "bg-amber-400", cooldown: "bg-slate-600",
};

const BPM_DEFAULTS: Record<string, { min: number; max: number }> = {
  warmup: { min: 100, max: 140 }, easy: { min: 125, max: 145 }, aerobic: { min: 125, max: 145 },
  tempo: { min: 160, max: 180 }, interval: { min: 175, max: 195 }, vo2max: { min: 175, max: 195 },
  recovery: { min: 125, max: 145 }, rest: { min: 80, max: 110 }, strides: { min: 160, max: 180 }, cooldown: { min: 60, max: 90 },
};

function newSegment(type: Segment["type"] = "easy", duration_s = 600): Segment {
  const bpm = BPM_DEFAULTS[type] ?? { min: 125, max: 145 };
  return { id: nanoid(), type, duration_s, bpm_min: bpm.min, bpm_max: bpm.max, bpm_tolerance: 8, sync_mode: "auto", valence_min: 0.3, valence_max: 0.7 };
}

interface Props {
  segments: Segment[];
  onChange: (segs: Segment[]) => void;
  focusedIdx: number | null;
  onFocus: (idx: number) => void;
  onPumpUp: (idx: number) => void;
}

export default function RunSegmentTimeline({ segments, onChange, focusedIdx, onFocus, onPumpUp }: Props) {
  function updateSegment(idx: number, s: Segment) {
    const next = [...segments]; next[idx] = s; onChange(next);
  }
  function removeSegment(idx: number) {
    onChange(segments.filter((_, i) => i !== idx));
    if (focusedIdx === idx) onFocus(-1);
  }
  function addSegment() {
    onChange([...segments, newSegment()]);
  }

  const totalMin = Math.round(segments.reduce((s, seg) => s + seg.duration_s, 0) / 60);

  return (
    <div className="flex flex-col h-full">
      <Reorder.Group axis="y" values={segments} onReorder={onChange} className="flex-1 overflow-y-auto p-3 space-y-1">
        <AnimatePresence>
          {segments.map((seg, idx) => {
            const isFocused = focusedIdx === idx;
            return (
              <Reorder.Item key={seg.id} value={seg} as="div">
                <motion.div
                  layout
                  animate={{ minHeight: isFocused ? 120 : 48 }}
                  className="rounded-lg border bg-card overflow-hidden"
                >
                  {/* Segment header */}
                  <div
                    className="flex items-center gap-2 p-2 cursor-pointer select-none"
                    onClick={() => onFocus(isFocused ? -1 : idx)}
                  >
                    <div className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground">
                      <GripVertical className="w-3 h-3" />
                    </div>
                    <div className={`w-1.5 h-8 rounded-full shrink-0 ${TYPE_COLORS[seg.type] ?? "bg-muted"}`} />
                    <span className="text-xs font-medium capitalize flex-1">{seg.type}</span>
                    <span className="text-xs text-muted-foreground">{Math.floor(seg.duration_s/60)}:{String(seg.duration_s%60).padStart(2,"0")}</span>
                    <span className="text-xs text-muted-foreground">{seg.bpm_min}–{seg.bpm_max} BPM</span>
                    <button onClick={(e) => { e.stopPropagation(); onPumpUp(idx); }} className="text-muted-foreground hover:text-amber-400 transition-colors p-0.5">
                      <Zap className="w-3 h-3" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); removeSegment(idx); }} className="text-muted-foreground hover:text-destructive transition-colors p-0.5">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>

                  <AnimatePresence>
                    {isFocused && (
                      <SegmentEditor key={seg.id} segment={seg} onChange={(s) => updateSegment(idx, s)} />
                    )}
                  </AnimatePresence>
                </motion.div>
              </Reorder.Item>
            );
          })}
        </AnimatePresence>
      </Reorder.Group>

      <div className="p-3 border-t flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={addSegment} className="text-xs h-7">
          <Plus className="w-3 h-3 mr-1" /> Add Segment
        </Button>
        <span className="text-xs text-muted-foreground ml-auto">Total: {totalMin} min</span>
      </div>
    </div>
  );
}
```

**Step 3: Build check + commit**

```bash
npm install nanoid  # if not already installed
cd /Users/gkos/projects/soma/.worktrees/spotify-playlist/web && npm run build 2>&1 | grep "error TS" | head -20
git add web/components/run-segment-timeline.tsx web/components/segment-editor.tsx
git commit -m "feat: add segment timeline (left panel) with inline editor + drag reorder"
```

---

### Task 12: Song Cards + Alternatives Strip

**Files:**
- Create: `web/components/song-card.tsx`
- Create: `web/components/song-alternatives-strip.tsx`

**Step 1: song-card.tsx**

```typescript
// web/components/song-card.tsx
"use client";
import { motion } from "framer-motion";
import { X, SkipForward, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";

export interface SongData {
  track_id: string; name: string; artist_name: string;
  tempo: number; energy: number; duration_ms: number;
  is_skip?: boolean; is_half_time?: boolean; has_genre_warning?: boolean;
}

interface Props {
  song: SongData;
  onExclude: () => void;
  onPreview: () => void;
  draggable?: boolean;
}

export default function SongCard({ song, onExclude, onPreview, draggable }: Props) {
  const durationStr = `${Math.floor(song.duration_ms / 60000)}:${String(Math.floor((song.duration_ms % 60000) / 1000)).padStart(2, "0")}`;
  const energyWidth = `${Math.round(song.energy * 100)}%`;

  if (song.is_skip) {
    return (
      <motion.div
        layout
        className="rounded-lg border-2 border-dashed border-muted-foreground/30 bg-muted/20 p-2.5"
      >
        <div className="flex items-center gap-2">
          <SkipForward className="w-4 h-4 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium truncate">{song.name}</div>
            <div className="text-xs text-muted-foreground truncate">{song.artist_name}</div>
          </div>
          <div className="text-xs text-muted-foreground whitespace-nowrap">{song.tempo.toFixed(0)} BPM</div>
          <Badge variant="outline" className="text-xs shrink-0">SKIP</Badge>
          <Tooltip>
            <TooltipTrigger>
              <Info className="w-3.5 h-3.5 text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-xs">
              Start this song before your segment ends. Skip it when your watch transitions — the next segment's music starts immediately.
            </TooltipContent>
          </Tooltip>
          <button onClick={onExclude} className="text-muted-foreground hover:text-destructive p-0.5">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      layout
      whileHover={{ scale: 1.01 }}
      className="group rounded-lg border bg-card p-2.5 cursor-pointer"
      onClick={onPreview}
    >
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium truncate">{song.name}</div>
          <div className="text-xs text-muted-foreground truncate">{song.artist_name}</div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {song.is_half_time && (
            <Tooltip>
              <TooltipTrigger>
                <Badge variant="outline" className="text-[10px] px-1 py-0">½</Badge>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-xs">
                This song runs at {song.tempo.toFixed(0)} BPM but feels right at {(song.tempo * 2).toFixed(0)} SPM — your foot lands on every other beat.
              </TooltipContent>
            </Tooltip>
          )}
          {song.has_genre_warning && (
            <Tooltip>
              <TooltipTrigger>
                <Badge variant="outline" className="text-[10px] px-1 py-0 border-amber-400 text-amber-400">⚠</Badge>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">Outside current genre filter — placed intentionally</TooltipContent>
            </Tooltip>
          )}
          <span className="text-xs text-muted-foreground">{song.tempo.toFixed(0)}</span>
          <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary/60 rounded-full" style={{ width: energyWidth }} />
          </div>
          <span className="text-xs text-muted-foreground hidden group-hover:block">{durationStr}</span>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onExclude(); }}
          className="text-muted-foreground hover:text-destructive p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </motion.div>
  );
}
```

**Step 2: song-alternatives-strip.tsx**

```typescript
// web/components/song-alternatives-strip.tsx
"use client";
import { motion, AnimatePresence } from "framer-motion";
import { Play, Plus, ChevronRight } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { SongData } from "./song-card";

interface Props {
  segmentConfig: {
    bpm_min: number; bpm_max: number; bpm_tolerance: number;
    valence_min: number; valence_max: number; min_energy: number;
    genres: string[]; exclude_ids: string[];
  };
  placedIds: Set<string>;
  onPreview: (song: SongData) => void;
  onPlace: (song: SongData) => void;
}

export default function SongAlternativesStrip({ segmentConfig, placedIds, onPreview, onPlace }: Props) {
  const [songs, setSongs] = useState<SongData[]>([]);
  const [loading, setLoading] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const stripRef = useRef<HTMLDivElement>(null);
  const [showFade, setShowFade] = useState(false);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      const params = new URLSearchParams({
        bpm_min: segmentConfig.bpm_min.toString(),
        bpm_max: segmentConfig.bpm_max.toString(),
        bpm_tol: segmentConfig.bpm_tolerance.toString(),
        energy_min: (segmentConfig.min_energy - 0.2).toString(),
        valence_min: segmentConfig.valence_min.toString(),
        valence_max: segmentConfig.valence_max.toString(),
        half_time: "true",
        exclude: Array.from(placedIds).join(","),
        ...(segmentConfig.genres.length > 0 ? { genres: segmentConfig.genres.join(",") } : {}),
      });
      try {
        const data = await fetch(`/api/playlist/tracks?${params}`).then(r => r.json());
        setSongs((data ?? []).filter((s: any) => !placedIds.has(s.track_id)).slice(0, 12));
      } catch {}
      setLoading(false);
    }, 400);
    return () => clearTimeout(debounceRef.current);
  }, [JSON.stringify(segmentConfig), placedIds.size]);

  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const check = () => setShowFade(el.scrollWidth > el.clientWidth && el.scrollLeft < el.scrollWidth - el.clientWidth - 10);
    check();
    el.addEventListener("scroll", check);
    return () => el.removeEventListener("scroll", check);
  }, [songs]);

  return (
    <div className="relative">
      <div ref={stripRef} className="flex gap-2 overflow-x-auto scrollbar-none py-1 pr-6">
        <AnimatePresence>
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <motion.div key={`sk-${i}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-40 h-14 rounded-lg bg-muted animate-pulse shrink-0" />
            ))
          ) : (
            songs.map((song) => (
              <motion.div
                key={song.track_id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="w-44 shrink-0 rounded-lg border bg-card p-2 flex flex-col gap-1"
              >
                <div className="text-xs font-medium truncate">{song.name}</div>
                <div className="text-xs text-muted-foreground truncate">{song.artist_name}</div>
                <div className="text-xs text-muted-foreground">{song.tempo.toFixed(0)} BPM</div>
                <div className="flex gap-1 mt-auto">
                  <button onClick={() => onPreview(song)} className="flex-1 flex items-center justify-center gap-1 text-xs border rounded hover:bg-muted py-0.5 transition-colors">
                    <Play className="w-3 h-3" /> Preview
                  </button>
                  <button onClick={() => onPlace(song)} className="flex-1 flex items-center justify-center gap-1 text-xs border rounded hover:bg-primary hover:text-primary-foreground py-0.5 transition-colors">
                    <Plus className="w-3 h-3" /> Place
                  </button>
                </div>
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>
      {showFade && (
        <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-background to-transparent flex items-center justify-end pr-0.5 pointer-events-none">
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </div>
      )}
    </div>
  );
}
```

**Step 3: Build check + commit**

```bash
cd /Users/gkos/projects/soma/.worktrees/spotify-playlist/web && npm run build 2>&1 | grep "error TS" | head -20
git add web/components/song-card.tsx web/components/song-alternatives-strip.tsx
git commit -m "feat: add song card and alternatives strip components"
```

---

### Task 13: Song Assignment Panel + Playlist Builder Orchestrator

**Files:**
- Create: `web/components/song-assignment-panel.tsx`
- Create: `web/components/playlist-builder.tsx`

**Step 1: song-assignment-panel.tsx (right panel)**

```typescript
// web/components/song-assignment-panel.tsx
"use client";
import { motion, AnimatePresence, Reorder } from "framer-motion";
import { Zap, AlertTriangle, ChevronDown } from "lucide-react";
import SongCard, { SongData } from "./song-card";
import SongAlternativesStrip from "./song-alternatives-strip";
import { Segment } from "./segment-editor";
import { useState } from "react";
import { Button } from "@/components/ui/button";

interface SegmentSongs {
  songs: SongData[];
  loading?: boolean;
  poolCount?: number;
  warning?: string;
}

interface Props {
  segments: Segment[];
  assignments: Record<number, SegmentSongs>;
  excludedIds: Set<string>;
  selectedGenres: string[];
  focusedIdx: number | null;
  onFocus: (idx: number) => void;
  onExclude: (segIdx: number, trackId: string) => void;
  onPlace: (segIdx: number, song: SongData) => void;
  onReorder: (segIdx: number, songs: SongData[]) => void;
  onPreview: (song: SongData) => void;
  onPumpUp: (segIdx: number) => void;
  onSave: () => void;
  saving: boolean;
  savedUrl?: string;
}

export default function SongAssignmentPanel({
  segments, assignments, excludedIds, selectedGenres,
  focusedIdx, onFocus, onExclude, onPlace, onReorder,
  onPreview, onPumpUp, onSave, saving, savedUrl
}: Props) {
  const [showExcluded, setShowExcluded] = useState<Record<number, boolean>>({});
  const allPlacedIds = new Set(
    Object.values(assignments).flatMap(a => a.songs.map(s => s.track_id))
  );

  const totalPlaced = Object.values(assignments).reduce((s, a) => s + a.songs.filter(x => !x.is_skip).length, 0);
  const totalTracks = Object.values(assignments).reduce((s, a) => s + a.songs.length, 0);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {segments.map((seg, idx) => {
          const assignment = assignments[idx];
          const isFocused = focusedIdx === idx;
          const songs = assignment?.songs ?? [];
          const excluded = songs.filter(s => excludedIds.has(s.track_id));
          const placed = songs.filter(s => !excludedIds.has(s.track_id));
          const nonSkip = placed.filter(s => !s.is_skip);
          const skipSong = placed.find(s => s.is_skip);

          return (
            <motion.div key={idx} layout animate={{ opacity: focusedIdx !== null && !isFocused ? 0.5 : 1 }}>
              {/* Segment header */}
              <button className="w-full flex items-center gap-2 text-left mb-2" onClick={() => onFocus(isFocused ? -1 : idx)}>
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground capitalize">{seg.type}</span>
                <span className="text-xs text-muted-foreground">{Math.floor(seg.duration_s/60)} min</span>
                <span className="text-xs text-muted-foreground">{seg.bpm_min}–{seg.bpm_max} BPM</span>
                {assignment?.warning && <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />}
                <button onClick={(e) => { e.stopPropagation(); onPumpUp(idx); }} className="ml-auto text-muted-foreground hover:text-amber-400 transition-colors">
                  <Zap className="w-3.5 h-3.5" />
                </button>
                {assignment && <span className="text-xs text-muted-foreground">Pool: {assignment.poolCount ?? "?"} · {nonSkip.length} placed</span>}
              </button>

              {/* Song list */}
              <Reorder.Group axis="y" values={nonSkip} onReorder={(reordered) => onReorder(idx, [...reordered, ...(skipSong ? [skipSong] : [])])} className="space-y-1.5">
                {assignment?.loading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <motion.div key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-12 rounded-lg bg-muted animate-pulse" style={{ animationDelay: `${i * 80}ms` }} />
                  ))
                ) : (
                  nonSkip.map(song => (
                    <Reorder.Item key={song.track_id} value={song} as="div">
                      <SongCard song={song} onExclude={() => onExclude(idx, song.track_id)} onPreview={() => onPreview(song)} draggable />
                    </Reorder.Item>
                  ))
                )}
              </Reorder.Group>

              {skipSong && !assignment?.loading && (
                <div className="mt-1.5">
                  <SongCard song={skipSong} onExclude={() => onExclude(idx, skipSong.track_id)} onPreview={() => onPreview(skipSong)} />
                </div>
              )}

              {/* Alternatives strip */}
              <div className="mt-2">
                <SongAlternativesStrip
                  segmentConfig={{ bpm_min: seg.bpm_min, bpm_max: seg.bpm_max, bpm_tolerance: seg.bpm_tolerance, valence_min: seg.valence_min, valence_max: seg.valence_max, min_energy: 0.5, genres: selectedGenres, exclude_ids: Array.from(excludedIds) }}
                  placedIds={allPlacedIds}
                  onPreview={onPreview}
                  onPlace={(song) => onPlace(idx, song)}
                />
              </div>

              {/* Excluded songs collapsible */}
              {excluded.length > 0 && (
                <div className="mt-2">
                  <button onClick={() => setShowExcluded(p => ({ ...p, [idx]: !p[idx] }))} className="text-xs text-muted-foreground flex items-center gap-1">
                    Excluded ({excluded.length}) <ChevronDown className={`w-3 h-3 transition-transform ${showExcluded[idx] ? "rotate-180" : ""}`} />
                  </button>
                  <AnimatePresence>
                    {showExcluded[idx] && (
                      <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden mt-1 space-y-1">
                        {excluded.map(s => (
                          <div key={s.track_id} className="flex items-center gap-2 p-1.5 rounded bg-muted/30 text-xs">
                            <span className="flex-1 truncate text-muted-foreground">{s.name} — {s.artist_name}</span>
                            <button onClick={() => onExclude(idx, s.track_id)} className="text-xs text-primary hover:underline">↩ Restore</button>
                          </div>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>

      {/* Footer: pool stats + save button */}
      <div className="p-3 border-t flex items-center gap-3">
        <span className="text-xs text-muted-foreground flex-1">
          {totalPlaced} songs · {totalTracks - totalPlaced} skip songs
        </span>
        {savedUrl ? (
          <Button size="sm" asChild className="text-xs h-7">
            <a href={savedUrl} target="_blank">✓ Open in Spotify ↗</a>
          </Button>
        ) : (
          <Button size="sm" onClick={onSave} disabled={saving} className="text-xs h-7">
            {saving ? "Saving…" : "Save to Spotify →"}
          </Button>
        )}
      </div>
    </div>
  );
}
```

**Step 2: playlist-builder.tsx — orchestrator**

```typescript
// web/components/playlist-builder.tsx
"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import PlaylistTopBar from "./playlist-top-bar";
import RunSegmentTimeline from "./run-segment-timeline";
import SongAssignmentPanel from "./song-assignment-panel";
import SpotifyPlayer from "./spotify-player";
import { Segment } from "./segment-editor";
import { SongData } from "./song-card";
import { useUndoRedo } from "@/hooks/use-undo-redo";
import { toast } from "sonner";

interface SegmentSongs { songs: SongData[]; loading?: boolean; poolCount?: number; warning?: string; }

export default function PlaylistBuilder() {
  const [segments, setSegments] = useUndoRedo<Segment[]>([]);
  const [assignments, setAssignments] = useState<Record<number, SegmentSongs>>({});
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null);
  const [sources, setSources] = useState<string[]>(["liked"]);
  const [genres, setGenres] = useState<string[]>([]);
  const [genreThreshold, setGenreThreshold] = useState(0.03);
  const [previewSong, setPreviewSong] = useState<SongData | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedUrl, setSavedUrl] = useState<string | undefined>();
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [workoutName, setWorkoutName] = useState<string | undefined>();

  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const syncingRef = useRef(false);

  // Hard scroll sync between panels
  useEffect(() => {
    const left = leftRef.current;
    const right = rightRef.current;
    if (!left || !right) return;
    const syncLeft = () => { if (syncingRef.current) return; syncingRef.current = true; right.scrollTop = left.scrollTop; syncingRef.current = false; };
    const syncRight = () => { if (syncingRef.current) return; syncingRef.current = true; left.scrollTop = right.scrollTop; syncingRef.current = false; };
    left.addEventListener("scroll", syncLeft);
    right.addEventListener("scroll", syncRight);
    return () => { left.removeEventListener("scroll", syncLeft); right.removeEventListener("scroll", syncRight); };
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); /* undo via hook */ }
      if ((e.ctrlKey || e.metaKey) && e.key === "y") { e.preventDefault(); /* redo via hook */ }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Generate playlist via SSE
  async function generate(segs: Segment[]) {
    setAssignments(Object.fromEntries(segs.map((_, i) => [i, { songs: [], loading: true }])));
    const res = await fetch("/api/playlist/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segments: segs, excluded_track_ids: Array.from(excludedIds), genre_selection: genres, genre_threshold: genreThreshold, source_playlist_ids: sources }),
    });
    if (!res.body) return;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const event = JSON.parse(line.slice(6));
        if (event.type === "segment_done") {
          setAssignments(prev => ({ ...prev, [event.index]: { songs: event.songs, loading: false, poolCount: event.pool_count } }));
        } else if (event.type === "segment_warning") {
          setAssignments(prev => ({ ...prev, [event.index]: { ...prev[event.index], warning: event.message } }));
        } else if (event.type === "done") {
          setSessionId(event.session_id);
        }
      }
    }
  }

  async function handleSave() {
    if (!sessionId) return;
    setSaving(true);
    const allTracks = Object.values(assignments).flatMap(a => a.songs.filter(s => !excludedIds.has(s.track_id)).map(s => s.track_id));
    const name = `Soma: ${workoutName ?? "Run"} · ${new Date().toLocaleDateString()}`;
    try {
      const res = await fetch("/api/playlist/spotify/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, name, track_ids: allTracks }),
      });
      const data = await res.json();
      setSavedUrl(data.playlist_url);
      toast.success("Playlist saved to Spotify!");
    } catch {
      toast.error("Failed to save playlist");
    } finally {
      setSaving(false);
    }
  }

  function handleExclude(segIdx: number, trackId: string) {
    setExcludedIds(prev => {
      const next = new Set(prev);
      if (next.has(trackId)) { next.delete(trackId); } else { next.add(trackId); }
      return next;
    });
    // Check blacklist learning
    fetch("/api/playlist/blacklist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ track_id: trackId }) });
  }

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      <PlaylistTopBar sources={sources} onSourcesChange={setSources} genres={genres} onGenresChange={setGenres} genreThreshold={genreThreshold} onThresholdChange={setGenreThreshold} workoutName={workoutName} />
      <div className="flex flex-1 overflow-hidden">
        {/* Left: run timeline */}
        <div ref={leftRef} className="w-[40%] border-r overflow-y-auto">
          <RunSegmentTimeline
            segments={segments}
            onChange={(segs) => { setSegments(segs); if (segs.length > 0) generate(segs); }}
            focusedIdx={focusedIdx}
            onFocus={(i) => setFocusedIdx(i === focusedIdx ? null : i)}
            onPumpUp={(idx) => { /* open pump-up modal */ }}
          />
        </div>
        {/* Right: song assignment */}
        <div ref={rightRef} className="flex-1 overflow-y-auto">
          <SongAssignmentPanel
            segments={segments}
            assignments={assignments}
            excludedIds={excludedIds}
            selectedGenres={genres}
            focusedIdx={focusedIdx}
            onFocus={(i) => setFocusedIdx(i === focusedIdx ? null : i)}
            onExclude={handleExclude}
            onPlace={(idx, song) => setAssignments(prev => ({ ...prev, [idx]: { ...prev[idx], songs: [...(prev[idx]?.songs ?? []).filter(s => !s.is_skip), song, ...(prev[idx]?.songs ?? []).filter(s => s.is_skip)] } }))}
            onReorder={(idx, songs) => setAssignments(prev => ({ ...prev, [idx]: { ...prev[idx], songs } }))}
            onPreview={setPreviewSong}
            onPumpUp={(idx) => { /* open pump-up modal */ }}
            onSave={handleSave}
            saving={saving}
            savedUrl={savedUrl}
          />
        </div>
      </div>
      {/* Mini player */}
      <SpotifyPlayer currentSong={previewSong} />
    </div>
  );
}
```

**Step 3: Build check + commit**

```bash
cd /Users/gkos/projects/soma/.worktrees/spotify-playlist/web && npm run build 2>&1 | grep "error TS" | head -20
git add web/components/song-assignment-panel.tsx web/components/playlist-builder.tsx
git commit -m "feat: add song assignment panel + playlist builder orchestrator"
```

---

## Phase 5: Advanced Features

### Task 14: Undo/Redo Hook + Spotify Mini Player

**Files:**
- Create: `web/hooks/use-undo-redo.ts`
- Create: `web/components/spotify-player.tsx`

**Step 1: use-undo-redo.ts (20-step history)**

```typescript
// web/hooks/use-undo-redo.ts
import { useState, useCallback, useEffect } from "react";

export function useUndoRedo<T>(initial: T): [T, (v: T) => void, () => void, () => void] {
  const [state, setState] = useState({ history: [initial], index: 0 });

  const set = useCallback((value: T) => {
    setState(prev => {
      const next = prev.history.slice(0, prev.index + 1);
      const trimmed = next.length >= 20 ? next.slice(1) : next;
      return { history: [...trimmed, value], index: trimmed.length };
    });
  }, []);

  const undo = useCallback(() => setState(prev => ({ ...prev, index: Math.max(0, prev.index - 1) })), []);
  const redo = useCallback(() => setState(prev => ({ ...prev, index: Math.min(prev.history.length - 1, prev.index + 1) })), []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "z") { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && (e.shiftKey && e.key === "z" || e.key === "y")) { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo]);

  return [state.history[state.index], set, undo, redo];
}
```

**Step 2: spotify-player.tsx (Web Playback SDK wrapper)**

```typescript
// web/components/spotify-player.tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { Play, Pause, Volume2 } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { motion, AnimatePresence } from "framer-motion";
import { SongData } from "./song-card";

interface Props { currentSong: SongData | null; }

export default function SpotifyPlayer({ currentSong }: Props) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.7);
  const playerRef = useRef<any>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    // Load Spotify Web Playback SDK
    const script = document.createElement("script");
    script.src = "https://sdk.scdn.co/spotify-player.js";
    script.async = true;
    document.head.appendChild(script);

    (window as any).onSpotifyWebPlaybackSDKReady = () => {
      fetch("/api/playlist/spotify/library")
        .then(r => r.json())
        .then(async () => {
          // Get access token for SDK
          const tokenRes = await fetch("/api/playlist/spotify/token");
          if (!tokenRes.ok) return;
          const { token } = await tokenRes.json();

          const player = new (window as any).Spotify.Player({
            name: "Soma Playlist Builder",
            getOAuthToken: (cb: (t: string) => void) => cb(token),
            volume,
          });

          player.addListener("player_state_changed", (state: any) => {
            if (!state) return;
            setIsPlaying(!state.paused);
            setPosition(state.position);
            setDuration(state.duration);
          });

          await player.connect();
          playerRef.current = player;
        });
    };

    return () => { document.head.removeChild(script); };
  }, []);

  // Poll position
  useEffect(() => {
    if (isPlaying) {
      intervalRef.current = setInterval(() => setPosition(p => p + 1000), 1000);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [isPlaying]);

  // Play song when it changes
  useEffect(() => {
    if (!currentSong || !playerRef.current) return;
    fetch(`https://api.spotify.com/v1/me/player/play`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uris: [`spotify:track:${currentSong.track_id}`] }),
    });
  }, [currentSong?.track_id]);

  const formatTime = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

  return (
    <div className="border-t bg-card px-4 py-2 flex items-center gap-4">
      <AnimatePresence mode="wait">
        {currentSong ? (
          <motion.div key={currentSong.track_id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="w-48 min-w-0">
            <div className="text-xs font-medium truncate">{currentSong.name}</div>
            <div className="text-xs text-muted-foreground truncate">{currentSong.artist_name}</div>
          </motion.div>
        ) : (
          <div className="w-48 text-xs text-muted-foreground">No song selected</div>
        )}
      </AnimatePresence>

      <button onClick={() => playerRef.current?.[isPlaying ? "pause" : "resume"]()} className="text-foreground hover:text-primary transition-colors">
        {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
      </button>

      <div className="flex-1 flex items-center gap-2">
        <span className="text-xs text-muted-foreground w-10 text-right">{formatTime(position)}</span>
        <Slider min={0} max={duration || 1} step={1000} value={[position]}
          onValueChange={([v]) => { setPosition(v); playerRef.current?.seek(v); }} className="flex-1" />
        <span className="text-xs text-muted-foreground w-10">{formatTime(duration)}</span>
      </div>

      {currentSong && <span className="text-xs text-muted-foreground">{currentSong.tempo.toFixed(0)} BPM</span>}

      <div className="flex items-center gap-1.5 w-24">
        <Volume2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <Slider min={0} max={1} step={0.05} value={[volume]}
          onValueChange={([v]) => { setVolume(v); playerRef.current?.setVolume(v); }} />
      </div>
    </div>
  );
}
```

**Step 3: Add token endpoint for Web Playback SDK**

```typescript
// web/app/api/playlist/spotify/token/route.ts
import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export async function GET() {
  const [row] = await sql`SELECT access_token FROM platform_credentials WHERE platform = 'spotify'`;
  if (!row) return NextResponse.json({ error: "Not connected" }, { status: 401 });
  return NextResponse.json({ token: (row as any).access_token });
}
```

**Step 4: Build check + commit**

```bash
cd /Users/gkos/projects/soma/.worktrees/spotify-playlist/web && npm run build 2>&1 | grep "error TS" | head -20
git add web/hooks/use-undo-redo.ts web/components/spotify-player.tsx web/app/api/playlist/spotify/token/
git commit -m "feat: add undo/redo hook + Spotify Web Playback SDK mini player"
```

---

### Task 15: Connections Page — Spotify Card

**Files:**
- Modify: `web/app/connections/page.tsx` (add Spotify card)

**Step 1: Find the connections page and existing card pattern**

```bash
grep -n "Strava\|Garmin\|platform_credentials\|Connected\|Disconnect" /Users/gkos/projects/soma/.worktrees/spotify-playlist/web/app/connections/page.tsx | head -30
```

**Step 2: Fetch Spotify connection status**

In the server component at top of `connections/page.tsx`, add:
```typescript
import { isSpotifyConnected, getSpotifyProfile } from "@/lib/spotify-client";
import { sql } from "@/lib/db";

// Inside the page function, alongside other connection checks:
const spotifyConnected = await isSpotifyConnected();
const spotifyProfile = spotifyConnected ? await getSpotifyProfile() : null;
const libraryStatus = spotifyConnected
  ? await sql`SELECT COUNT(*) FILTER (WHERE tempo IS NOT NULL) AS tracks_with_bpm, COUNT(*) AS total_tracks, MAX(cached_at) AS last_synced FROM spotify_track_features`.then(r => r[0])
  : null;
```

**Step 3: Add Spotify card alongside existing cards**

Find where Strava or Hevy card is rendered. Add a similar card:
```tsx
{/* Spotify Card — add next to existing provider cards */}
<div className="group rounded-xl border bg-card p-5 hover:shadow-md transition-all">
  <div className="flex items-center justify-between">
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-full bg-[#1DB954] flex items-center justify-center shrink-0">
        {/* Spotify logo icon - use a simple Music icon as placeholder */}
        <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>
      </div>
      <div>
        <div className="font-medium text-sm">Spotify</div>
        {spotifyConnected && spotifyProfile && (
          <div className="text-xs text-muted-foreground">{spotifyProfile.display_name}</div>
        )}
      </div>
    </div>
    {spotifyConnected ? (
      <span className="text-xs text-green-500 font-medium">● Connected</span>
    ) : (
      <a href="/api/playlist/spotify/auth" className="text-xs text-primary hover:underline">Connect →</a>
    )}
  </div>

  {/* Rich hover info (shown when connected) */}
  {spotifyConnected && libraryStatus && (
    <div className="mt-3 pt-3 border-t opacity-0 group-hover:opacity-100 transition-opacity text-xs text-muted-foreground space-y-1">
      <div>{(libraryStatus as any).tracks_with_bpm} tracks analysed · {(libraryStatus as any).total_tracks} total</div>
      {(libraryStatus as any).last_synced && (
        <div>Last synced {new Date((libraryStatus as any).last_synced).toLocaleDateString()}</div>
      )}
      <a href="/playlist" className="text-primary hover:underline block mt-1">Go to Playlist Builder →</a>
    </div>
  )}

  {spotifyConnected && (
    <div className="mt-3 pt-3 border-t flex gap-2">
      <a href="/playlist" className="text-xs text-primary hover:underline">Open Builder →</a>
      <form action="/api/playlist/spotify/disconnect" method="POST" className="ml-auto">
        <button type="submit" className="text-xs text-muted-foreground hover:text-destructive">Disconnect</button>
      </form>
    </div>
  )}
</div>
```

**Step 4: Add disconnect endpoint**

```typescript
// web/app/api/playlist/spotify/disconnect/route.ts
import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export async function POST() {
  await sql`DELETE FROM platform_credentials WHERE platform = 'spotify'`;
  return NextResponse.redirect(`${process.env.NEXT_PUBLIC_BASE_URL}/connections`);
}
```

**Step 5: Build check + commit**

```bash
cd /Users/gkos/projects/soma/.worktrees/spotify-playlist/web && npm run build 2>&1 | grep "error TS" | head -20
git add web/app/connections/page.tsx web/app/api/playlist/spotify/disconnect/
git commit -m "feat: add Spotify card to connections page with rich hover state"
```

---

## Phase 6: Verification + Screenshot

### Task 16: End-to-End Build Verification + Screenshots

**Step 1: Full production build**

```bash
cd /Users/gkos/projects/soma/.worktrees/spotify-playlist/web && npm run build 2>&1 | tail -30
```
Expected: `✓ Compiled successfully` with no TypeScript errors. Note any warnings.

**Step 2: Start dev server**

```bash
cd /Users/gkos/projects/soma/.worktrees/spotify-playlist && ./dev.sh
```
Wait for `ready on http://localhost:3456`.

**Step 3: Screenshot connections page (Spotify card)**

```bash
npx -y playwright screenshot --wait-for-timeout=5000 http://localhost:3456/connections /tmp/connections-spotify.png 2>/dev/null
```
Read the screenshot and verify: Spotify card appears alongside Garmin/Hevy/Strava cards.

**Step 4: Screenshot playlist page (onboarding)**

```bash
npx -y playwright screenshot --wait-for-timeout=5000 http://localhost:3456/playlist /tmp/playlist-onboarding.png 2>/dev/null
```
Verify: 3-step onboarding checklist shown, steps 2+3 visually locked.

**Step 5: Screenshot playlist builder (after connecting)**

If Spotify is connected:
```bash
npx -y playwright screenshot --wait-for-timeout=8000 --full-page http://localhost:3456/playlist /tmp/playlist-builder.png 2>/dev/null
```
Verify: Two-panel layout, top bar with dropdowns, sticky mini player at bottom.

**Step 6: Final commit**

```bash
git add -A
git commit -m "feat: complete Spotify playlist builder - all phases"
```

---

## Summary Checklist

- [ ] Task 1: DB migration (8 tables)
- [ ] Task 2: Spotify OAuth PKCE (auth + callback)
- [ ] Task 3: spotify-client.ts (silent token refresh)
- [ ] Task 4: reccobeats-client.ts + lastfm-client.ts + genre-mapper.ts
- [ ] Task 5: Library ingestion API (POST/GET /api/playlist/spotify/library)
- [ ] Task 6: All backend APIs (tracks, genres, preferences, sessions, pump-up, blacklist, playlists, create, garmin-runs)
- [ ] Task 7: GH Actions cron
- [ ] Task 8: garmin-lap-parser.ts
- [ ] Task 9: Page shell + onboarding (playlist/page.tsx + playlist-client.tsx)
- [ ] Task 10: Top bar + source/genre pickers + run selector (4 tabs)
- [ ] Task 11: Segment timeline (left panel) + segment editor
- [ ] Task 12: Song card + alternatives strip
- [ ] Task 13: Song assignment panel + playlist builder orchestrator
- [ ] Task 14: Undo/redo hook + Spotify mini player
- [ ] Task 15: Connections page Spotify card
- [ ] Task 16: Build verification + screenshots

## Environment Variables Required

Add to `web/.env.local`:
```
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
SPOTIFY_REDIRECT_URI=http://localhost:3456/api/playlist/spotify/callback
LASTFM_API_KEY=
CRON_SECRET=
```

Add to GitHub repo secrets (for cron workflow):
```
CRON_SECRET=
NEXT_PUBLIC_BASE_URL=https://your-deployment-url.vercel.app
```

## Spotify App Setup

1. Go to https://developer.spotify.com/dashboard
2. Create app → set Redirect URI to `http://localhost:3456/api/playlist/spotify/callback`
3. Add yourself as test user (Dev Mode limit: 5 users)
4. Copy Client ID + Client Secret to `.env.local`
