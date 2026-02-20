# Soma — Personal Health Intelligence Platform

## Design Document

**Date**: 2026-02-20
**Status**: Approved (brainstorming complete)

---

## 1. Vision

Soma is an open-source, science-driven personal health intelligence platform that unifies workout data, health metrics, body composition, and nutrition into a single beautiful dashboard — with every recommendation backed by peer-reviewed research.

**Core problem**: Body recomposition (building muscle while losing fat) requires synthesizing data across multiple sources and making evidence-based decisions about nutrition and training. No existing tool does this well.

**End goal**: A system that tells you exactly what to eat (based on foods you like) to optimize your body composition, backed by scientific literature, with a complete picture of your health data.

---

## 2. User Profile

- **Device**: Garmin Forerunner 965
- **Workout tracking**: Hevy (Pro) for strength training
- **Running**: Strava (synced to Garmin via RunGap)
- **Sync chain**: Hevy → Strava/Apple Health → RunGap → Garmin Connect
- **Approach**: Eating healthy with protein priority, not currently counting calories
- **Goal**: Lose belly fat while maintaining/building muscle (body recomposition)
- **Supplements**: Tracked (specifics TBD)

---

## 3. Architecture

### 3.1 System Overview

```
┌─────────────────────────────────┐
│  Next.js Dashboard (Vercel)     │  ← Free hosting, reads from DB
│  - All pages, charts, UI        │
│  - API routes for CRUD          │
│  - Mobile-responsive             │
└──────────┬──────────────────────┘
           │ reads/writes
┌──────────▼──────────────────────┐
│  PostgreSQL (Supabase/Neon)     │  ← Free tier, cloud DB
│  - Raw data lake (JSON)         │
│  - Structured views             │
│  - Analytics tables             │
└──────────▲──────────────────────┘
           │ syncs data
┌──────────┴──────────────────────┐
│  Python Sync Engine (local)     │  ← Runs on Mac via cron
│  - Garmin connector             │
│  - Hevy connector               │
│  - Analytics/calculations       │
│  - Scientific computations      │
└─────────────────────────────────┘
```

### 3.2 Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Next.js 14+ (App Router), TypeScript |
| **UI** | Tailwind CSS, shadcn/ui, Recharts, Framer Motion |
| **Backend API** | Next.js API Routes (deployed on Vercel) |
| **Database** | PostgreSQL (Supabase or Neon free tier) |
| **Data Sync** | Python 3.12+, python-garminconnect, hevy-api |
| **Analytics** | Python (pandas, numpy, scipy) |
| **Deployment** | Vercel (frontend), local cron (sync engine) |
| **Version Control** | GitHub (public repo, data/code separated) |

### 3.3 Data Sources

| Source | Library | Data |
|--------|---------|------|
| **Garmin Connect** | `python-garminconnect` (105+ methods) | HR, HRV, sleep, stress, body battery, SpO2, weight, body composition, calories, steps, VO2 max, training readiness, activities |
| **Hevy API** | `hevy-api` (official, Pro required) | Workouts, exercises, sets, reps, weight, RPE, set types, routines |

### 3.4 Deduplication Strategy

The same workout exists in both Garmin (HR/calories) and Hevy (exercises/sets). Strategy:

1. **Match by time overlap** — Hevy workout time overlapping Garmin activity within ±15min = same session
2. **Hevy = authority for strength data** (exercises, sets, reps, weight, RPE)
3. **Garmin = authority for biometric data** (HR zones, calories, training effect)
4. **Merged record** gets best of both sources
5. **HR overlay** — Garmin's second-by-second HR mapped onto individual Hevy sets
6. **For cardio** — Garmin is sole authority (richer than RunGap chain data)
7. `linked_activities` table maps Garmin activity_id ↔ Hevy workout_id

---

## 4. Data Storage — Three-Layer Architecture

### Layer 1: Raw Data Lake

Store every API response verbatim. Never lose data.

```sql
garmin_raw_data (date, endpoint_name, raw_json, synced_at)
hevy_raw_data (synced_at, endpoint_name, raw_json)
```

### Layer 2: Structured Views

Parsed, queryable tables created from raw data via ETL scripts. Easy to add new fields — write a new parser, backfill from Layer 1.

```
daily_health_summary    -- one row per day, all health metrics
activities              -- unified timeline (strength + cardio)
workout_sets            -- per-set data with HR overlay
weight_log              -- weight entries with moving averages
sleep_detail            -- sleep stages, scores, duration
hr_timeseries           -- per-second HR during activities
supplements             -- daily supplement/vitamin intake
```

### Layer 3: Computed Analytics

Derived metrics, predictions, and recommendations. Recalculated on sync.

```
analytics_tdee          -- daily TDEE from Garmin calorie data
analytics_macro_targets -- personalized protein/fat/carb targets
analytics_training_volume -- sets per muscle group per week
analytics_1rm_estimates -- estimated 1RM per exercise over time
analytics_weight_trend  -- 7-day and 30-day moving averages
analytics_correlations  -- sleep vs performance, stress vs weight, etc.
```

**Extensibility**: New metric = new parser script + backfill from raw data. No schema migration needed in Layer 1.

---

## 5. Dashboard Pages

### 5.1 Landing Page (public)

- Hero with animated health data visualization
- "Your body's data, backed by science"
- Feature showcase with smooth animations
- Open source badge, GitHub link
- "Deploy your own" CTA
- Built with Framer Motion

### 5.2 App Pages (built incrementally)

**Home Dashboard** — Daily command center
- Today's snapshot: weight trend, calories burned, sleep score, training readiness
- Weekly summary cards
- AI-generated actionable nudges

**Workout Analytics** — Hevy data
- Per-exercise progression charts
- Volume per muscle group heatmap
- Estimated 1RM trends
- HR overlay on workout timeline
- Workout frequency calendar (GitHub-style heatmap)

**Running & Cardio** — Garmin data
- Pace trends, HR zone distribution
- VO2 max progression, race predictions
- Individual run detail with map, splits, HR chart

**Body & Weight**
- Weight trend with moving averages
- Body composition changes
- Correlation views (weight vs. calories vs. training volume)
- Goal tracker with projected timeline

**Nutrition** (Phase 2+)
- Food log, macro breakdown
- Daily calorie target vs. actual (TDEE from Garmin)
- Meal planner with AI suggestions
- Recipe database

**Supplements**
- Daily tracking of vitamins/supplements
- Dosage, timing, consistency tracking

**Science Lab** (Phase 3+)
- Personalized recommendations with paper citations
- AI analysis of trends
- Experiment tracker

---

## 6. UI Design Principles

- **Dark-mode first** — clean, professional (Linear/Vercel/Raycast aesthetic)
- **Mobile-responsive** — bottom tab nav, swipeable cards, charts resize
- **Minimal chrome** — data speaks, every pixel earns its place
- **Color palette** — neutral grays + teal/cyan accent
- **Components** — shadcn/ui + Recharts + Framer Motion
- **Loading states** — skeleton loaders, no layout shifts
- **Empty states** — beautiful illustrations with setup CTAs

---

## 7. Scientific Engine

### Development Methodology: Research-First

Every new metric, analysis, or predictor follows this workflow:

1. **RESEARCH** — Deep literature review via Scholar Gateway + web search
2. **DESIGN** — Choose method based on evidence, document with citations
3. **IMPLEMENT** — Code with paper DOIs in comments, test against known values
4. **DOCUMENT** — Every number in the UI links to "how is this calculated?" with citations

### Core Calculations (Phase 1)

- **BMR**: Mifflin-St Jeor equation
- **TDEE**: Actual Garmin calorie data (measured, not estimated)
- **Caloric target**: TDEE - 10-20% deficit (evidence-based for recomp)
- **Macro targets**: Protein 1.6-2.2g/kg, Fat ≥0.5g/kg, Carbs fill remainder
- **1RM estimation**: Epley formula
- **Training volume**: Sets per muscle group per week
- **Weight trend**: 7-day exponential moving average

### AI Agent Workflows (Claude Code)

- **Science Agent**: Scholar Gateway searches → cited recommendations
- **Analysis Agent**: Statistical correlations across health data
- **Diet Agent**: Constraint optimization for meal plans matching macro targets + food preferences
- **Code Agent**: GitHub search for existing implementations

---

## 8. Data/Code Separation (Open Source)

- `.env.example` with placeholder values (committed)
- `.env` with real credentials (gitignored)
- All personal data lives only in the database
- Config file defines which connectors to enable
- New users: clone repo → set `.env` → run sync → deploy to Vercel

---

## 9. Phased Roadmap

Each phase is a **mini research project** — research first, then build.

| Phase | Scope | Deliverable |
|-------|-------|-------------|
| **1** | Repo setup + DB + Garmin sync (daily health + weight) | Working data pipeline, basic dashboard |
| **2** | Hevy workout sync + workout analytics page | Exercise progression, volume tracking, HR overlay |
| **3** | Running/cardio analytics page | Pace trends, HR zones, VO2 max, maps |
| **4** | Body composition & weight trend analysis | Moving averages, projections, correlations |
| **5** | Nutrition module + supplement tracking | Food log, macro tracking, supplement log |
| **6** | AI diet optimizer + Science Lab | Meal plans, research-backed recommendations |
| **7** | Landing page + polish + public launch | Beautiful landing page, documentation, onboarding |

Each phase = working feature, tested, deployed, before moving on.

---

## 10. MCP Servers (Available for Integration)

Research identified these existing MCP servers:

| Service | Best MCP Server | Stars |
|---------|----------------|-------|
| Garmin Connect | `eddmann/garmin-connect-mcp` or `Nicolasvegam/garmin-connect-mcp` (61 tools) | 8-12 |
| Hevy | `chrisdoc/hevy-mcp` | — |
| Strava | `r-huijts/strava-mcp` | 246 |
| Apple Health | `neiltron/apple-health-mcp` | 518 |

We may install these for Claude Code to query health data directly during development/analysis sessions, separate from the main application data pipeline.

---

## 11. Key Libraries

### Python (Sync Engine)
- `garminconnect` — Garmin Connect API (105+ methods)
- `hevy-api` — Hevy official API wrapper
- `garmin-fit-sdk` — FIT file parsing
- `pandas`, `numpy`, `scipy` — data analysis
- `sqlalchemy` — database ORM
- `apscheduler` — job scheduling

### JavaScript/TypeScript (Frontend)
- `next` — React framework (App Router)
- `tailwindcss` — utility-first CSS
- `shadcn/ui` — component library
- `recharts` — data visualization
- `framer-motion` — animations
- `tanstack/table` — data tables
- `supabase-js` or `@neondatabase/serverless` — DB client

---

## 12. Open Questions

- Exact Supabase vs. Neon choice (evaluate free tier limits)
- Domain name for landing page (soma.dev? getsoma.app?)
- Supplement list and dosages (user to provide)
- Food preferences for diet optimization (user to provide)
- Whether to build a custom MCP server for Soma itself
