# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What Is Soma

Open-source personal health intelligence platform. Aggregates data from Garmin (biometrics) and Hevy (strength training) into a unified dashboard with analytics.

## Monorepo Structure

- **`web/`** — Next.js 16 frontend (App Router, TypeScript, Tailwind CSS 4, shadcn/ui)
- **`sync/`** — Python data sync engine (fetches from Garmin + Hevy APIs, stores in Neon PostgreSQL)
- **`.github/workflows/sync.yml`** — Hourly GitHub Actions cron that runs the Python pipeline
- **`docs/plans/`** — Architecture and design documents

## Commands

### Web (Next.js)

```bash
cd web
npm run dev          # Dev server on :3456
npm run build        # Production build
npm run lint         # ESLint
# Or from repo root:
./dev.sh             # Kills stale processes, starts on :3456
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

### Environment Variables

Copy `.env.example` to `.env` at repo root. Required: `DATABASE_URL`, `GARMIN_EMAIL`, `GARMIN_PASSWORD`, `HEVY_API_KEY`.

## Architecture

### Database: Three-Layer Design (`sync/schema.sql`)

1. **Layer 1 — Raw Data Lake**: `garmin_raw_data`, `hevy_raw_data`, `garmin_activity_raw`, `garmin_profile_raw`. JSONB blobs from APIs, never mutated after insert.
2. **Layer 2 — Structured**: `daily_health_summary`, `weight_log`, `sleep_detail`, `workout_enrichment`. Parsed from Layer 1 with typed columns.
3. **Layer 3 — Analytics**: `analytics_weight_trend`. Computed aggregates (7d/30d averages, deltas).

Metadata tables: `sync_log`, `backfill_progress`.

### Data Authority

- **Garmin** = authority for biometrics (HR, calories, stress, sleep, body battery, steps)
- **Hevy** = authority for strength training (exercises, sets, reps, weight, RPE)
- **Workout enrichment** merges both: Hevy workouts matched to Garmin activities by time overlap (±15min) for HR overlay on sets

### Sync Pipeline (`sync/src/pipeline.py`)

Orchestration flow: `pipeline.py` → `garmin_sync.py` / `hevy_sync.py` (fetch raw) → `parsers.py` (structure) → `activity_replacer.py` (enrich workouts with HR). Smart mode auto-detects incomplete days by checking HR data point count (<650 = stale).

Key modules:
- `garmin_client.py` / `hevy_client.py` — API wrappers
- `exercise_mapper.py` — Deduplicates exercise names across sources
- `fit_generator.py` — Generates FIT files for Garmin upload
- `db.py` — psycopg2 connection management and sync logging

### Frontend Patterns

- **Server components with inline SQL**: Pages (`page.tsx`) are async server components that query Neon directly via `getDb()` tagged template literals. No separate data layer.
- **ISR**: `export const revalidate = 300` on pages for 5-minute cache.
- **Database client**: `web/lib/db.ts` exports `getDb()` which returns a Neon SQL tagged template function.
- **Components**: shadcn/ui primitives in `web/components/ui/`, domain components at `web/components/`. Charts use Recharts. Animations use Motion.
- **Path alias**: `@/*` maps to `web/*` (configured in `tsconfig.json`).

### API Routes (`web/app/api/`)

- `sync/` — Triggers Python pipeline via child process + GitHub Actions dispatch
- `stats/[metric]/` — Time-series health metrics
- `activity/[id]/` — Individual activity details
- `workout/[id]/` — Individual workout with enrichment
- `workouts/exercise/` — Exercise-level analytics
- `health/today/`, `health/weight/` — Current health data
- `duplicates/`, `duplicates/resolve/` — Workout deduplication management
- `weekly-comparison/` — Week-over-week metrics

## Git Rules

- NEVER add Claude as co-author in commits (no `Co-Authored-By: Claude` lines)
