# Changelog

Soma is a continuously-deployed self-hosted training stack. This changelog
documents notable changes to the codebase organized by theme. The format is
loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## TypeScript consolidation ([#159](https://github.com/drkostas/soma/issues/159))

The whole stack moved to **one language, TypeScript**. The Python `sync/` was
deleted; the ingest/routing/notification pipeline now runs as GitHub Actions
(`scripts/sync-pipeline.mts`) + Vercel cron functions. Self-contained subsystems
are published as **npm packages** that soma imports as thin re-export shims.
Cross-repo progress is tracked in the [Soma Ecosystem project](https://github.com/users/drkostas/projects/9).

### Shipped

- **macro-engine-core** `0.1.1` ([#160](https://github.com/drkostas/soma/issues/160)) — nutrition math (TDEE, deficit, sleep/alcohol/day-close, macro targets) with 2322 golden-parity cases. Deleted the Python `sync/src/nutrition_engine`.
- **banister** `0.2.0` ([#161](https://github.com/drkostas/soma/issues/161)) — fitness/fatigue predict + differential-evolution fit, VDOT, calibration.
- **run-dj** `0.3.0` ([#162](https://github.com/drkostas/soma/issues/162)) — HR→BPM formula, interleaved shuffle, segment playlist scoring. `web/lib/{bpm-formula,dj-shuffle,playlist-algorithm}.ts` re-export from it.
- **garmin-auth** `0.4.1` ([#164](https://github.com/drkostas/soma/issues/164)) — self-healing Garmin OAuth + token store (TS).
- **hevy2garmin core** ([#163](https://github.com/drkostas/soma/issues/163)) — Hevy→FIT→Garmin in TS.
- **soma-core** ([#165](https://github.com/drkostas/soma/issues/165)) — the whole `sync/` pipeline ported to TS crons; Python `sync/` deleted.
- **hevy2garmin integration** ([#2](https://github.com/drkostas/soma/issues/2)) and **garmin-auth** ([#3](https://github.com/drkostas/soma/issues/3)) — the earlier Python-package extractions (predecessors to the TS move above).

## Universal UI ([#223](https://github.com/drkostas/soma/issues/223))

- Unified all product UIs (soma, macro-engine, hevy2garmin) onto **one** RN framework — Expo + React Native Web + NativeWind — consuming the shared [`soma-style`](https://github.com/drkostas/soma-style) design system. Each repo gains a cross-platform `universal/` app.
- soma `universal/`: Overview (live health), Nutrition (+ preset meal-logging, log-a-drink, close-day writes), Training (PMC/readiness/fitness + a readiness-weighting toggle).
- New read-only endpoint `GET /api/hevy/status` (recent Hevy workouts + Garmin sync counts) powering the hevy2garmin universal dashboard.

## Sync pipeline

### Recent

- Dedup window reduced from 30 min to 10 min to avoid missing workouts.
- Incremental Hevy sync + skip unchanged Garmin workouts.
- Batch PMC upsert (141s → 1.7s) and commit missing training engine files.
- Stale HR enrichment retries limited to the last 7 days (55s → 1s).
- Cron frequency increased to every 30 min (6am-midnight EDT).
- Garmin token refresh moved from Vercel cron to GitHub Actions (Vercel cron was unreliable).
- Self-healing Garmin auth with full-login fallback on Vercel.
- OAuth1→OAuth2 exchange uses real consumer credentials in full-login flow.
- Proper cookie tracking across SSO redirect chain.

### Known open issues

- **Vercel preview deploys fail on PR branches** ([#7](https://github.com/drkostas/soma/issues/7)) — investigating env var scoping and branch deploy config.
- **Training engine transaction errors in sync pipeline** ([#8](https://github.com/drkostas/soma/issues/8)) — partial failures leave DB in inconsistent state.

## Nutrition

### Recent

- Per-ingredient unit step: tuna/eggs whole only, others 0.25 increments.
- Sleep-based deficit adjustments disabled (now a consistent deficit).
- Unit-based serving sizes for ingredients with natural unit counts.
- Unit/gram toggle with correct slider stepping for count-based inputs.
- Support half/quarter units for count-based ingredients.
- Slider steps 1g for grams, text box accepts any value.

## Training engine

### Recent

- Honest trajectory status card: trend-based on-track assessment.
- Trend prediction: 21 calendar days, properly anchored.
- Data-driven trend prediction with confidence band.
- Goal pace line + fix for gym double-counting.
- Banister full model (fitness − fatigue) replaces fitness-only trajectory.

## Sharing

### Recent

- Run/gym share images redesigned: 4:3 landscape layout.
- Trajectory chart redesign: unified colors, interpolated tooltips, cumulative deficit card.
- Burn vs Eaten chart: stacked bars + eaten dots overlay.
