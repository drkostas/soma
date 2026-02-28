# Spotify Playlist Generator — Full Design
**Date**: 2026-02-27
**Status**: Design complete ✅

---

## Overview

A `/playlist` page in Soma that lets the user build a structured run, then generates a BPM-matched Spotify playlist where each segment has its own song selection. Songs change exactly when segment intensity changes — the user manually skips the last song of each segment (the "skip song") to advance to the next segment's music.

---

## Core Mechanic

- Each segment has N songs + 1 "skip song" at the end
- Songs 1..N play fully within the segment duration
- Song N+1 (skip song) starts playing before the segment ends — user presses skip when their Garmin transitions to the next segment
- Constraint: `sum(songs 1..N) ≤ segment_duration - 60s` (skip song starts at least 60s before transition)
- Songs ordered BPM ascending within segment (natural crescendo build); skip song locked to last position

---

## User Flow

```
1. /playlist page opens
   └─ Stepped onboarding if not set up (see Onboarding section)

2. Pick a run (left panel — tabbed selector)
   └─ Tab 1: Past Garmin runs (searchable by name/date)
   └─ Tab 2: Saved planned runs (pre-built workout plans in DB)
   └─ Tab 3: Manual builder (full segment editor)
   └─ Tab 4: History (past playlist sessions, fully editable)

3. Configure music source (Sources ▾ dropdown in top bar)
   └─ Multi-select: Liked Songs + any of your playlists
   └─ Shows track count per source
   └─ "Analyse Library" button → ReccoBeats batch fetch (100 IDs/call, ~4s for 2000 tracks)

4. Pick genres (Genres ▾ dropdown in top bar)
   └─ After analysis: macro-genre chips with track counts
   └─ Threshold: adjustable slider (default 3%, range 1-10%)
   └─ Multi-select: user picks any subset (default: all)
   └─ Genre disappearing/appearing animated smoothly on threshold change

5. Visual builder loads (two-panel, sticky top bar + player)
   └─ Left: run segment timeline (Y-axis = time, accordion focus)
   └─ Right: song assignment (segments with filled songs + alternatives strip)
   └─ Bottom: mini Spotify player (Web Playback SDK, full scrubbing)

6. Refine
   └─ Click [↺] on any song → swap with alternative
   └─ Click [✕] on any song → exclude globally (collapsible excluded chip)
   └─ Click any alternative → preview in player, [+ place] to place
   └─ Drag songs within a segment to reorder (skip song locked last)
   └─ ⚡ on segment header → inject pump-up song
   └─ Ctrl+Z/Y for undo/redo (20-step history)
   └─ Keyboard shortcuts: E=exclude, Space=preview, Enter=place, ?=cheatsheet

7. Save to Spotify
   └─ Creates playlist "Soma: [workout name] · [date]"
   └─ Button lifecycle: "Save to Spotify →" → "Saving…" → "✓ Saved · Open in Spotify ↗"
   └─ After editing saved session: "Update Playlist →"
   └─ Playlist saved to DB for future reference
```

---

## Onboarding (First-Time)

Stepped checklist shown in center of page when nothing is set up:

```
Step 1: ① Connect Spotify     [Connect →]
Step 2: ② Analyse your library   (unlocks after step 1)
Step 3: ③ Pick a run              (unlocks after step 2)
```

- Step completion: check-draw animation, next step slides in with spring
- Once all steps done, transition to full builder (steps collapse, builder slides up)
- One-time explainer banner on first build: skip song mechanic explanation (dismissable forever)

---

## Page Layout

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Sidebar │ TOP BAR (sticky)                                                │
│         │ [Workout ▾]  [Sources ▾]  [Genres ▾]                           │
├─────────┼──────────────────────────┬───────────────────────────────────  │
│         │  RUN PANEL (40%)         │  SONG PANEL (60%)                   │
│         │  Y-axis = time           │  Y-axis = time (hard-synced scroll)  │
│         │  accordion focus         │                                      │
│         │  [segment blocks]        │  [song cards + alternatives strips]  │
│         │                          │                                      │
│         │  [+ Add Segment]         │  Pool: 312 songs · 47 used · 265 left│
│         │  Total: 42 min           │              [Save to Spotify →]     │
├─────────┴──────────────────────────┴─────────────────────────────────────┤
│ MINI PLAYER (sticky)                                                      │
│ ▶ God's Plan — Drake  ██████████░░░  2:14/4:01  163 BPM  ████░  🔊       │
└──────────────────────────────────────────────────────────────────────────┘
```

- Both panels scroll together (hard sync — scrolling either panel scrolls both)
- Clicking a segment in either panel focuses it: focused segment expands, others compress to 48px min
- Top bar: Sources and Genres are compact dropdown buttons, never overflow
- Sidebar remains (standard Soma layout), page is scrollable

---

## Run Sources

### Tab 1: Past Garmin Runs
- Search bar at top (filters by name/date, debounced)
- Query `garmin_activity_raw` for running activities
- Parses `splits` endpoint (lapDTOs) for segments
- Shows: date, name, distance, type badge (Structured / Easy), duration

### Tab 2: Saved Planned Runs
- Stored in `workout_plans` table
- Shows: name, total duration, segment count

### Tab 3: Manual Builder
Full segment editor — see Segment Editor section below.

### Tab 4: Session History
- Past playlist sessions: date, run name, track count, Spotify link
- Click → loads full session into builder (fully editable)
- "Duplicate as new" option to start a variant without overwriting original
- Editing and re-saving updates the existing Spotify playlist (PUT /playlists/{id}/tracks)

---

## Run Change Behaviour

**Switching runs or making structural changes → Full reset with confirmation dialog.**

"This will regenerate all song assignments. Continue?" — clean slate, no stale songs from wrong BPM range.

**Editing a segment duration → Regenerate that segment only.**

Placed songs for that segment are discarded; algorithm re-runs for the modified segment.

**Editing segment type → Regenerate that segment only.**

Same as duration change.

---

## Segment Editor (Left Panel)

### Segment Block

- Proportional height (accordion: focused = expanded, others = 48px min)
- Left border strip = segment type color
- Drag handle (≡) to reorder segments
- Click block body → expand inline editor with spring animation
- Delete: block shrinks vertically to 0, gap closes

### Inline Segment Editor

```
Type:       [Tempo ▾]
Duration:   [20] min  [00] sec
Sync/Async: [Sync ●] [Async ○]   ← per-segment toggle
BPM range:  [160] – [180]  ±[8] tolerance
Valence:    [😤]──●──────●──[😊]  0.1 – 0.5
Zone:       [Zone 4 ▾]  ← auto-fills from type
[Advanced ▾]
  End condition: [Time ▾]
```

All settings per segment type are persisted to DB and restored on next session.

### Repeat Group Editor

Expanding a repeat group shows:
- Repeat count input at top
- Each sub-step (active + recovery) with individual type/duration/intensity editors
- "Skip last recovery" toggle (common for last interval in a set)
- [Unbundle] button to expand into individual segments

### Auto-Bundle Rule

Consecutive segments each ≤ 2 min in a repeat pattern → collapsed "Strides Block" automatically.
Total duration drives song selection as one unit. [Unbundle] to expand.

### Segment Types → Colors + Icons

```
WARMUP   → yellow    🌅
EASY     → green     🟢
AEROBIC  → blue      🔵
TEMPO    → orange    🟠
INTERVAL → red       🔴
VO2max   → purple    🟣
RECOVERY → sky blue  🩵
REST     → slate     ⬜
STRIDES  → amber     ⚡
COOLDOWN → dark slate 🌙
```

Type color bar transitions smoothly (Framer Motion) when type changes in editor.

---

## BPM & Intensity Mapping

| Segment | HR Zone | Mode | Music BPM | Half-time BPM | Min Energy |
|---|---|---|---|---|---|
| Warmup | Z1 | async | 100–140 | 50–70 | 0.4 |
| Easy/Recovery | Z1–Z2 | async | 125–145 | 63–73 | 0.5 |
| Aerobic base | Z2 | async | 125–145 | 63–73 | 0.6 |
| Tempo/Threshold | Z3–Z4 | sync | 160–180 | 80–90 | 0.75 |
| VO2max interval | Z4–Z5 | sync | 175–195 | 88–98 | 0.85 |
| Sprint | Z5 | sync | 180–200 | 90–100 | 0.9 |
| Cooldown | Z1 | async | 60–90 | 30–45 | 0.3 |
| Rest | — | async | 80–110 | 40–55 | 0.3 |

**Sync mode** (Zone 3+): cadence-matched BPM, runner steps in time with beat.
**Async mode** (Zone 1-2): motivational range regardless of cadence.
Per-segment toggle overrides the default.

### Half-time Matching

Search `[target ÷ 2 ± tolerance] UNION [target ± tolerance]` — doubles the pool.
Songs matched at half-time show a **½ badge** with tooltip: "This song runs at 88 BPM but feels right at 176 SPM — your foot lands on every other beat."

### Valence Defaults Per Segment Type

| Segment | Default range | Vibe |
|---|---|---|
| Warmup | 0.4 – 0.8 | moderate |
| Easy/Aerobic | 0.4 – 0.8 | moderate |
| Tempo/Threshold | 0.1 – 0.5 | dark/aggressive |
| Interval/VO2max | 0.0 – 0.4 | very dark |
| Recovery/Rest | 0.4 – 0.8 | moderate |
| Cooldown | 0.6 – 1.0 | uplifting |
| Strides | 0.1 – 0.5 | aggressive |

User can drag either handle of the dual-range slider. All settings persisted to DB by segment type.

---

## Algorithm

**Lexicographic bi-criteria 0/1 Knapsack** — exact optimal, quality primary, fill secondary.

### Approach: Value Packing

Pack both objectives into a single composite score per song:

```typescript
const GAP = capacity + 1;   // quality unit = GAP fill units → quality always dominates
const QSCALE = 1_000_000;   // 6 decimal places of quality

composite[i] = Math.round(songs[i].quality_score * QSCALE) * GAP + songs[i].duration_s
```

Single standard 0/1 DP pass gives lexicographic optimum.

### Complexity

N=500, W=1800 → 900K ops → **~2-5ms in Node.js V8** (Float64Array inner loop).
Typical case (N=100-200, W=600) → ~0.1-0.5ms.

### Full Implementation

```typescript
function selectSongsForSegment(songs: SongCandidate[], capacity: number): SongCandidate[] {
  const n = songs.length;
  if (n === 0 || capacity <= 0) return [];

  const GAP = capacity + 1;
  const QSCALE = 1_000_000;

  const dp = new Float64Array(capacity + 1);
  const chosen = new Uint8Array((n + 1) * (capacity + 1));

  for (let i = 0; i < n; i++) {
    const w = Math.floor(songs[i].duration_ms / 1000);
    const c = Math.round(songs[i].quality_score * QSCALE) * GAP + w;
    for (let j = capacity; j >= w; j--) {
      const candidate = dp[j - w] + c;
      if (candidate > dp[j]) {
        dp[j] = candidate;
        chosen[i * (capacity + 1) + j] = 1;
      }
    }
  }

  // Backtrack
  const selected: SongCandidate[] = [];
  let j = capacity;
  for (let i = n - 1; i >= 0; i--) {
    if (chosen[i * (capacity + 1) + j]) {
      selected.push(songs[i]);
      j -= Math.floor(songs[i].duration_ms / 1000);
    }
  }
  return selected;
}
```

Memory: dp=14.4KB, chosen=~900KB at worst case. Total <1MB per call.

### Quality Score

```typescript
function qualityScore(song, cfg) {
  const bpmRange = cfg.max - cfg.min;
  const bpmDist = Math.abs(song.tempo - cfg.center);
  const bpmScore = Math.max(0, 1 - bpmDist / (bpmRange / 2));
  const energyScore = Math.max(0, 1 - Math.abs(song.energy - (cfg.min_energy + 0.1)));
  return 0.6 * bpmScore + 0.4 * energyScore;
}
```

### Post-Processing

After DP selects the set:
1. **Sort by BPM ascending** (natural crescendo build)
2. **Artist diversity check**: if 2+ consecutive songs from same artist, swap 3rd with best-quality alternative from different artist
3. **Add skip song**: first remaining candidate not in placed set, duration ≥ 60s (skip song locked to last)

### Streaming Response

API streams results segment by segment via Server-Sent Events. Frontend renders each segment as it arrives — skeleton cards fade out, real cards fade in per-segment. Full playlist feels like it "assembles itself."

### Pool Exhaustion Handling

If fewer than 3 candidates found for a segment:
- Warning banner on segment header: "⚠ Only 2 songs found"
- Two one-tap fix buttons: [Widen BPM ±15] and [Add more playlists]
- Tapping a fix applies it and regenerates that segment only

---

## Song Assignment Panel (Right Panel)

### Segment Section Header

```
TEMPO  20 min  Zone 4  160–180 BPM  [⚡]   Pool: 47 songs · 4 placed · 43 remaining
```

### Song Card (Progressive Disclosure)

Base state (always visible): title, artist, BPM, energy bar, ✕ exclude
Contextual badges (appear when relevant): ½ (half-time match), ⚠ (outside current genre filter)
On hover: genre tag, duration

```
┌───────────────────────────────────────────┐
│ ▶  God's Plan — Drake          [✕]        │
│    163 BPM  ████░ energy                  │
│    [½] if half-time match                 │
│    [⚠] if outside genre filter            │
└───────────────────────────────────────────┘
```

### Skip Song Card (visually distinct)

```
┌───────────────────────────────────────────┐
│ ◄◄  Rockstar — 21 Savage       [✕]        │
│     160 BPM  SKIP AT TRANSITION           │
│     ⓘ  (tooltip explaining mechanic)      │
└───────────────────────────────────────────┘
```

ⓘ tooltip: "Start this song before your segment ends. Skip it when your watch transitions — the next segment's music starts immediately."

### Genre Filter Warning (⚠ badge)

If user deselects a genre after placing songs, placed songs of that genre get a ⚠ badge.
They stay in place — they were placed intentionally. User decides whether to remove them.

### Drag Reorder

Songs 1..N-1 can be dragged to reorder within a segment. Skip song is locked to last.
Framer Motion layout animation: blocks make room as you drag.

### Excluded Songs

Collapsible chip at bottom of each segment, hidden when count = 0:
`Excluded (3) ↓` → expands to list of excluded songs with [↩ Restore] per song.

### Alternatives Strip

Horizontal scrollable row next to each song card:
- 4 alternatives visible initially, right edge fades to transparent with `›` chevron
- Scroll for more (up to 12 per page)
- Each card: artist, title, BPM, energy bar, [▶ preview] and [+ place] buttons (always visible simultaneously)
- Already-placed songs (in any segment) hidden from all strips
- Already-excluded songs hidden from all strips
- Refreshes instantly on any segment setting change (debounced 400ms)

### Pump-Up Song ⚡

- ⚡ button in segment header injects a pinned pump-up track as next song
- Pin pump-up songs: right-click / long-press any song in builder → "⚡ Add to pump-up bank"
- Manage pump-up bank: ⚡ button in top bar opens modal with pinned tracks + [✕ remove] per track
- Maximum 10 pump-up songs in bank

---

## Blacklist Learning

- Track exclude count per song in DB (across sessions)
- After 3 excludes: toast "You've excluded '[Song]' 3 times — Never suggest it again?" with [Yes] [Dismiss]
- If confirmed: song permanently hidden from all future sessions (stored in `user_blacklist` table)

---

## Spotify Integration

### OAuth

- Flow: Authorization Code with **PKCE** (Implicit Grant deprecated)
- Scopes: `user-library-read`, `playlist-read-private`, `playlist-modify-private`, `user-modify-playback-state`, `user-read-playback-state`
- Tokens stored in `platform_credentials` table (same as Strava)
- Token refresh: silent automatic refresh on every API call. If refresh token revoked: toast "Spotify session expired — reconnect to save" with reconnect link

### Library Ingestion

```
1. POST /api/playlist/spotify/library with { source_ids: ['liked', 'playlist_id', ...] }
2. Fetch tracks from each source (paginated, Spotify API)
3. Batch BPM fetch: GET https://api.reccobeats.com/v1/audio-features?ids=id1,id2,...,id100
   → Returns data.content[] — no auth required, free, supports 100 IDs per call
   → 2000 songs = 20 calls ≈ 4 seconds total
4. Fetch artist genres: GET /artists/{id} per unique artist
   → If empty: Last.fm fallback (artist.getTopTags)
5. Apply macro-genre mapping (micro → macro)
6. Store in spotify_track_features + spotify_artist_genres tables
7. Cache aggressively — never re-fetch an artist or track already in DB
```

**Incremental refresh**: GH Actions cron (daily at 3am). Checks for new tracks vs DB count. Fetches only uncached tracks. No Vercel timeout concerns.

### BPM Source: ReccoBeats

- URL: `https://api.reccobeats.com/v1/audio-features?ids={comma-separated-spotify-ids}`
- Returns: `data.content[]` with tempo, energy, valence, danceability, key, mode
- Free, no authentication required
- Batch of 100 IDs per request

### Genre Pipeline

```
micro-genre → macro-genre mapping (~15 buckets):
dark trap, melodic rap, phonk, drill → Hip-Hop
house, techno, trance, drum and bass → Electronic
indie pop, indie rock, indie folk → Indie
classic rock, hard rock, metal → Rock
r&b, soul, funk → R&B/Soul
reggaeton, latin pop, afrobeats → Latin/Global
classical, orchestral, jazz → Ambient/Jazz
pop, synth-pop, electropop → Pop
country, americana, folk → Country/Folk
```

Frequency filter: show only macro-genres with ≥ threshold% of pool tracks (default 3%, adjustable 1-10%).

### Playlist Creation

```
Playlist name: "Soma: [workout name] · [date]"
(Spotify API cannot create folders — naming convention provides grouping)

POST /users/{id}/playlists → create
POST /playlists/{id}/tracks → add tracks (max 100/call, batch if more)
```

### Web Playback SDK (Mini Player)

- JavaScript SDK embedded in page
- Requires Spotify Premium
- Play/pause, seek to position, volume
- Clicking [▶ preview] on any alternative loads it into player without placing
- Progress bar with scrub handle
- Track title crossfades on change

---

## Genre Picker

Genres ▾ dropdown in top bar:
- Macro-genre chips with track counts
- Multi-select (all selected by default)
- Threshold dual-handle slider (1-10%, default 3%)
- Chips appear/disappear with smooth animation as threshold changes
- Genre count shows live next to each chip

---

## Data Model

```sql
-- Cached track features
CREATE TABLE spotify_track_features (
  track_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  artist_id TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  tempo FLOAT,
  energy FLOAT,
  valence FLOAT,
  danceability FLOAT,
  genres TEXT[],        -- macro-genre buckets
  raw_genres TEXT[],
  cached_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON spotify_track_features(tempo);
CREATE INDEX ON spotify_track_features USING GIN(genres);

-- Cached artist genres
CREATE TABLE spotify_artist_genres (
  artist_id TEXT PRIMARY KEY,
  artist_name TEXT NOT NULL,
  genres TEXT[],
  macro_genres TEXT[],
  source TEXT,
  cached_at TIMESTAMPTZ DEFAULT NOW()
);

-- Saved workout plans
CREATE TABLE workout_plans (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  sport_type TEXT DEFAULT 'running',
  segments JSONB NOT NULL,
  total_duration_s INTEGER,
  source TEXT DEFAULT 'manual',
  garmin_activity_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Playlist sessions
CREATE TABLE playlist_sessions (
  id SERIAL PRIMARY KEY,
  workout_plan_id INTEGER REFERENCES workout_plans(id),
  garmin_activity_id TEXT,
  source_playlist_ids TEXT[],
  genre_selection TEXT[],
  genre_threshold FLOAT DEFAULT 0.03,
  song_assignments JSONB,   -- {segment_index: [{track_id, duration_ms, is_skip, is_half_time}]}
  excluded_track_ids TEXT[],
  spotify_playlist_id TEXT,
  spotify_playlist_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User preferences (per segment type)
CREATE TABLE playlist_preferences (
  id SERIAL PRIMARY KEY,
  segment_type TEXT NOT NULL UNIQUE,
  sync_mode TEXT DEFAULT 'auto',  -- 'sync' | 'async' | 'auto'
  bpm_min INTEGER,
  bpm_max INTEGER,
  bpm_tolerance INTEGER DEFAULT 8,
  valence_min FLOAT,
  valence_max FLOAT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User blacklist (permanently excluded tracks)
CREATE TABLE user_blacklist (
  track_id TEXT PRIMARY KEY,
  name TEXT,
  artist_name TEXT,
  blacklisted_at TIMESTAMPTZ DEFAULT NOW()
);

-- Per-track exclude count (for blacklist learning)
CREATE TABLE track_exclude_counts (
  track_id TEXT PRIMARY KEY,
  exclude_count INTEGER DEFAULT 0,
  last_excluded_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pump-up song bank
CREATE TABLE pump_up_songs (
  track_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  tempo FLOAT,
  energy FLOAT,
  added_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Page Architecture

```
web/app/playlist/
├── page.tsx                         ← server component, checks Spotify connection
└── playlist-client.tsx              ← "use client", main interactive UI

web/components/
├── playlist-builder.tsx             ← orchestrator (Framer Motion provider)
├── playlist-run-selector.tsx        ← 4-tab left panel selector
├── run-segment-timeline.tsx         ← left panel: segment blocks
├── segment-editor.tsx               ← inline segment editor
├── song-assignment-panel.tsx        ← right panel: song strips
├── song-card.tsx                    ← individual song card (selected + skip variants)
├── song-alternatives-strip.tsx      ← horizontal alternatives row
├── playlist-genre-picker.tsx        ← genre chip selector (in Genres ▾ dropdown)
├── playlist-source-picker.tsx       ← source selector (in Sources ▾ dropdown)
├── spotify-player.tsx               ← bottom mini player (Web Playback SDK)
└── pump-up-modal.tsx                ← pump-up song bank manager

web/lib/
├── spotify-client.ts                ← Spotify API wrapper (token refresh, spotifyFetch)
├── reccobeats-client.ts             ← ReccoBeats batch BPM client
├── lastfm-client.ts                 ← Last.fm genre fallback
├── genre-mapper.ts                  ← micro→macro genre mapping table
└── playlist-algorithm.ts            ← lexicographic bi-criteria DP knapsack
```

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | /api/playlist/spotify/auth | Initiate Spotify PKCE OAuth |
| GET | /api/playlist/spotify/callback | Handle OAuth callback |
| POST | /api/playlist/spotify/library | Ingest + cache user library (ReccoBeats batch) |
| GET | /api/playlist/spotify/library | Status: total tracks, tracks with BPM |
| GET | /api/playlist/spotify/playlists | List user's Spotify playlists |
| POST | /api/playlist/spotify/create | Create/update Spotify playlist from session |
| GET | /api/playlist/sessions | List past sessions |
| POST | /api/playlist/sessions | Create session (triggers streaming algorithm) |
| GET | /api/playlist/sessions/[id] | Get session with full song assignments |
| PUT | /api/playlist/sessions/[id] | Update session (swap, exclude, reorder) |
| GET | /api/playlist/workout-plans | List saved plans |
| POST | /api/playlist/workout-plans | Save a plan |
| GET | /api/playlist/garmin-runs | List recent Garmin runs with parsed segments |
| GET | /api/playlist/tracks | Query track pool by BPM/energy/genre/valence |
| GET | /api/playlist/genres | Genre distribution of cached library |
| GET | /api/playlist/preferences | Get per-segment-type preferences |
| PUT | /api/playlist/preferences | Update preferences |
| GET | /api/playlist/pump-up | List pump-up songs |
| POST | /api/playlist/pump-up | Add to pump-up bank |
| DELETE | /api/playlist/pump-up/[id] | Remove from bank |
| POST | /api/playlist/blacklist | Add to permanent blacklist |
| GET | /api/playlist/blacklist | List blacklisted tracks |

---

## Animation Strategy (Framer Motion)

### Entry / Navigation
- Page loads: panels slide up from below, staggered (left → right → player)
- Onboarding step completion: check-draw animation, next step slides in with spring

### Run Selection → Builder Transition
- Selector collapses with smooth height animation
- Segment blocks cascade in from top, 30ms stagger per block
- Right panel skeleton cards appear simultaneously

### Segment Interactions
- Expand/collapse: smooth height with spring physics
- Drag reorder: Framer Motion layout animation — blocks compress in real time
- Type change: left color bar transitions between colors
- Delete: block shrinks to 0, gap closes smoothly
- Accordion focus: focused segment expands, others compress to 48px

### Song Card Lifecycle
- Skeleton → real card: shimmer fades, content fades + scales from 0.95 → 1.0 per segment
- Exclude: card slides left + shrinks, gap closes
- Place from strip: strip card fades, new card drops into segment
- Pump-up inject: card bounces in with spring
- ½ badge: pop-in on first render
- ⚠ badge: soft pulse to draw attention

### Controls
- Genre chips: scale on toggle, smooth color transition
- Chips disappear/appear with fade when threshold changes
- Pool counter: numbers count up/down when songs placed
- Save button: pulse on click, check-draw on success

### Micro-interactions
- Mini player track change: title crossfades
- Alternatives strip refresh: brief skeleton shimmer → cards slide in from right
- Undo: reverses the specific animation that just played
- Scroll sync: silky smooth synchronized scrolling between panels
- Repeat group sub-steps: cascade down with stagger on expand

---

## Garmin Lap Parsing

### Structured Workouts (hasSplits = true)

```
1. Filter out post-workout laps (wktStepIndex = null)
2. Group consecutive laps with same (wktStepIndex, intensityType)
3. Detect repeat iterations: transition BACK to same wktStepIndex = new repetition
   NOTE: wktStepIndex CYCLES in repeat groups (doesn't increment)
4. Map intensityType:
   WARMUP → warmup, INTERVAL | ACTIVE → interval (same thing, firmware rename),
   RECOVERY → recovery, REST → rest, COOLDOWN → cooldown
5. Per group: sum(duration), sum(distance), avg(speed), avg(HR)
```

### Unstructured Runs

```
1. Compute pace per lap
2. 3-lap rolling average smoothing
3. Classify each lap into HR zone using user's Garmin zone thresholds
4. Group consecutive same-zone laps → segments
```

### Treadmill Detection
`startLatitude = null` in lapDTOs → flag as treadmill. Music selection unaffected.

---

## Edge Cases

| Scenario | Handling |
|---|---|
| Pool < 3 songs | Warning banner + [Widen BPM ±15] / [Add more playlists] buttons |
| Zero songs in macro-genre after threshold | Auto-lower threshold for that genre, show "adjusted" badge |
| Duplicate songs across playlists | Deduplicated by track_id, counted once |
| Segment duration < 3 min | May have only 1 song + skip song. Valid |
| Treadmill run | Parse normally, segment types apply |
| Podcast/episode in playlist | Filter: tracks with type='track' only |
| Local files in playlist | Skip: is_local=true tracks have no Spotify ID |
| User changes run after placement | Full reset with confirmation dialog |
| User edits segment duration | Regenerate that segment only |
| User changes genre filter | Flag placed songs with ⚠, don't remove |
| Genre filter change | Only affects alternatives strip + future generations |
| ReccoBeats API down | Cache-first; if not cached show BPM as "?" allow manual entry |
| Spotify Premium lapses | Web Playback SDK fails; fall back to 30s preview URL |
| Token expiry mid-session | Silent automatic refresh; if refresh token revoked → toast |
| 3+ songs excluded | Prompt "Never suggest again?" — add to permanent blacklist |
| Artist diversity violation | Post-DP: swap 3rd+ consecutive same-artist with best alternative |
| Skip song shorter than 60s | Skip: add to placed songs instead, find new skip song |

---

## Connections Page Integration

Spotify card added to `/connections` page alongside Garmin, Hevy, Strava.

**Connected state** (matches Strava pattern):
- Green "Connected" badge
- Display name from Spotify profile
- "Disconnect" button
- "Go to Playlist Builder →" link

**Rich hover state** (progressive disclosure):
- "1,432 tracks analysed · Last synced 3h ago · Next sync tonight at 3am"

---

## Research Findings

### Spotify API (Feb 2026)
- Audio features (BPM) BLOCKED for new apps → use **ReccoBeats** (free, batch, no auth)
- Batch track/artist endpoints removed → fetch one artist at a time, cache aggressively
- PKCE OAuth required (Implicit Grant deprecated)
- Web Playback SDK: free, Premium required, full playback + seek
- Playlist folders: NOT supported via API → naming convention only
- Max 5 test users in Dev Mode (fine for personal use)

### ReccoBeats API (Feb 2026)
- Endpoint: `GET https://api.reccobeats.com/v1/audio-features?ids={comma-separated}`
- Returns: `data.content[]` with tempo, energy, valence, danceability, key, mode
- Batch of 100 IDs per call, free, no authentication required
- 2000 songs = 20 calls ≈ 4 seconds

### Garmin Data
- `wktStepIndex` CYCLES in repeat groups — group by transitions, not index
- `INTERVAL` == `ACTIVE` — firmware rename, treat identically
- `hasSplits` in summary → detect structured workout
- All data in `garmin_activity_raw` table, endpoint_name='splits'
- Treadmill: `startLatitude = null` in lapDTOs

### Algorithm
- Lexicographic bi-criteria 0/1 Knapsack is exact optimal for this problem
- O(N×W) = 900K ops at N=500, W=1800 → 2-5ms in Node.js V8
- FPTAS and Branch-and-Bound both worse for this problem size
- Greedy leaves 5-10% quality on table — not good enough
- Pareto-front DP overkill (lexicographic, not Pareto trade-off)
- Memory: ~900KB per call (Uint8Array chosen table) — acceptable

### BPM Science
- Half-time matching essential: 90 BPM = 180 SPM cadence
- Zone 1-2: async motivational range; Zone 3+: sync cadence-matched
- Energy score as important as BPM — use both for quality score
- BPM ascending within segment = natural build feel
- Max 2 consecutive songs from same artist (post-processing)
