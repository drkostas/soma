# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What Is Soma

Open-source personal health intelligence platform. Aggregates data from Garmin (biometrics), Hevy (strength training), and Strava (activities) into a unified dashboard with analytics. Syncs bidirectionally — pulls data in, pushes enriched activities out to Strava and Garmin with descriptions and share images. Notifications via Telegram and Web Push.

## Monorepo Structure

- **`web/`** — Next.js 16 frontend (App Router, React 19, TypeScript, Tailwind CSS 4, shadcn/ui)
- **`sync/`** — Python 3.10+ data sync engine (fetches from APIs, stores in Neon PostgreSQL)
- **`.github/workflows/sync.yml`** — Every-4-hours GitHub Actions cron that runs the Python pipeline
- **`docs/plans/`** — Architecture and design documents

## Commands

### Web (Next.js)

```bash
cd web
npm run dev          # Dev server on :3456
npm run build        # Production build (uses --webpack flag)
npm run lint         # ESLint
# Or from repo root:
./dev.sh             # Kills stale processes on :3456, starts dev server
```

### Sync (Python)

```bash
cd sync
pip install -e ".[dev]"           # Install with dev deps (pytest)
python -m src.pipeline            # Smart sync (auto-detects stale dates)
python -m src.pipeline 3          # Sync last N days explicitly
pytest                            # Run all tests
pytest tests/test_parsers.py      # Single test file
pytest tests/test_parsers.py -k "test_name"  # Single test
```

Pytest is configured in `pyproject.toml`: `testpaths = ["tests"]`, `pythonpath = ["src"]`.

### Environment Variables

Copy `.env.example` to `.env` at repo root. Required: `DATABASE_URL`, `GARMIN_EMAIL`, `GARMIN_PASSWORD`, `HEVY_API_KEY`. Optional: `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `GITHUB_PAT`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `SOMA_WEB_URL`, `VAPID_*` keys.

## Architecture

### Database: Three-Layer Design (`sync/schema.sql`)

1. **Layer 1 — Raw Data Lake**: `garmin_raw_data`, `hevy_raw_data`, `garmin_activity_raw`, `garmin_profile_raw`, `strava_raw_data`. JSONB blobs from APIs, never mutated after insert.
2. **Layer 2 — Structured**: `daily_health_summary`, `weight_log`, `sleep_detail`, `workout_enrichment`. Parsed from Layer 1 with typed columns.
3. **Layer 3 — Analytics**: `analytics_weight_trend`. Computed aggregates (7d/30d averages, deltas).

Metadata tables: `sync_log`, `backfill_progress`, `activity_sync_log`, `sync_rules`, `platform_credentials`, `push_subscriptions`.

### Data Authority

- **Garmin** = authority for biometrics (HR, calories, stress, sleep, body battery, steps)
- **Hevy** = authority for strength training (exercises, sets, reps, weight, RPE)
- **Strava** = authority for GPS activities (runs, rides, etc.)
- **Workout enrichment** merges Hevy + Garmin: workouts matched to Garmin activities by time overlap (±15min) for HR overlay on sets

### Sync Pipeline (`sync/src/pipeline.py`)

The pipeline runs as a single `run_pipeline()` call with these sequential phases:

1. **Garmin daily sync** — Fetch daily health endpoints + activity details for stale dates (smart mode auto-detects via HR data point count <650 = incomplete)
2. **Hevy sync** — Fetch latest 10 workouts from Hevy API
3. **Strava sync** — Pull recent activities if credentials are configured (OAuth tokens stored in `platform_credentials`)
4. **Parse** — Process raw JSONB into structured tables via `parsers.py`
5. **Enrich** — Match Hevy workouts to Garmin activities for HR overlay (`activity_replacer.py`)
6. **Upload to Garmin** — Generate FIT files from enriched workouts, upload to Garmin Connect
7. **Route** — Rule engine (`router.py`) dispatches activities to configured destinations (Strava, Telegram, Push)
8. **Garmin run enrichment** — Set descriptions + upload share card images to Garmin run activities
9. **Notification backfill** — Send Telegram/Push notifications for activities that were missed
10. **Reconcile** — Match Strava syncs to prevent duplicates (`reconciler.py`)
11. **Structured workouts** — Sync Garmin workout plans and push pending plans

Key sync modules:
- `garmin_client.py` / `hevy_client.py` / `strava_client.py` — API wrappers
- `router.py` — Rule engine: matches activities to `sync_rules` rows, dispatches to push connectors (Strava, Telegram, Push), with anti-loop and dedup via `activity_sync_log`
- `strava_push.py` / `garmin_push.py` — Generate FIT files and push activities to Strava/Garmin
- `strava_description.py` — Generate rich text descriptions for pushed activities
- `telegram_notify.py` / `push_notify.py` — Send workout/run share images via Telegram bot API and Web Push
- `exercise_mapper.py` — Deduplicates exercise names across sources
- `fit_generator.py` — Generates FIT files for Garmin/Strava upload
- `db.py` — psycopg2 connection management, sync logging, credential storage
- `reconciler.py` — Prevents duplicate Strava uploads by matching existing activities
- `dj_daemon.py` / `bpm_formula.py` / `shuffle.py` — Playlist DJ engine (BPM-based music selection)

### Frontend Patterns

- **Server components with inline SQL**: Pages (`page.tsx`) are async server components that query Neon directly via `getDb()` tagged template literals. No separate data layer.
- **ISR**: `export const revalidate = 300` on pages for 5-minute cache.
- **Database client**: `web/lib/db.ts` exports `getDb()` (Neon SQL tagged template function) and `withDbRetry()` (retries on Neon cold-start errors).
- **Components**: shadcn/ui primitives in `web/components/ui/`, domain components at `web/components/`. Charts use Recharts. Animations use Motion. Maps use MapLibre GL via react-map-gl.
- **Path alias**: `@/*` maps to `web/*` (configured in `tsconfig.json`).

### Authentication

- **NextAuth v5** (beta) with GitHub OAuth provider (`web/auth.ts`)
- **Owner-only access**: `GITHUB_OWNER_USERNAME` env var restricts login to a single GitHub account
- **Middleware** (`web/middleware.ts`): Redirects unauthenticated users to `/login`. Exempts: `/api/auth/*`, `/login`, image API endpoints (`/api/workout/[id]/image`, `/api/activity/[id]/image`), service worker, manifest
- **Demo mode**: Set `DEMO_MODE=true` to bypass auth entirely

### PWA Support

- **Serwist** service worker (`web/app/sw.ts`) configured in `web/next.config.ts`
- **Web Push notifications** via VAPID keys — subscriptions stored in `push_subscriptions` table
- Disabled in development mode

### Pages

- `/` — Overview dashboard (steps, HR, stress, body battery, recent activity)
- `/running` — Running analytics (pace progression, mileage, VO2max, heatmap)
- `/workouts` — Strength training (muscle activation map, exercise progression, PRs)
- `/sleep` — Sleep & recovery (stages, HRV, SpO2, body battery, training readiness)
- `/activities` — Activity list with details
- `/connections` — Sync hub (platform connections, sync rules, push configuration)
- `/status` — Sync status and pipeline health
- `/playlist` — DJ/playlist feature (BPM-matched music, Spotify integration)
- `/login` — GitHub OAuth login

### API Routes (`web/app/api/`)

- `auth/[...nextauth]/` — NextAuth handlers
- `sync/`, `sync/status/`, `sync/activity/` — Trigger pipeline, check status
- `stats/[metric]/` — Time-series health metrics
- `activity/[id]/`, `activity/[id]/strava-photo/` — Activity details and images
- `workout/[id]/` — Workout details with enrichment
- `workouts/exercise/` — Exercise-level analytics
- `health/today/`, `health/weight/` — Current health data
- `duplicates/`, `duplicates/resolve/` — Workout deduplication management
- `weekly-comparison/` — Week-over-week metrics
- `connections/`, `connections/rules/`, `connections/[platform]/` — Platform credential and sync rule management
- `strava/auth/`, `strava/callback/` — Strava OAuth flow
- `outliers/`, `outliers/fix/` — Data outlier detection and correction
- `running/recent-routes/`, `running/heatmap/` — Running map data
- `notifications/subscribe/`, `notifications/preferences/` — Web Push subscription management
- `playlist/*` — DJ engine (Spotify auth, track management, BPM-based sessions, workout plans)

### GitHub Actions

- **`sync.yml`**: Runs every 4 hours. Has a circuit breaker that pauses scheduled runs after a failure (manual trigger resumes). Skips if a successful sync completed within the last hour. Uses `concurrency: sync` to prevent overlapping runs.
- **`spotify-library-refresh.yml`**: Refreshes Spotify library data for the playlist feature.

## Git Rules

- NEVER add Claude as co-author in commits (no `Co-Authored-By: Claude` lines)
