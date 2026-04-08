# Changelog

Soma is a continuously-deployed self-hosted training stack. This changelog
documents notable changes to the codebase organized by theme. The format is
loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Modularization (ongoing)

Extracting self-contained subsystems from `sync/src/` into standalone PyPI
packages so other people can use them without running all of soma. Cross-repo
progress is tracked in the [Soma Ecosystem project](https://github.com/users/drkostas/projects/9).

### Shipped

- **hevy2garmin integration** ([#2](https://github.com/drkostas/soma/issues/2), [#1](https://github.com/drkostas/soma/pull/1)) — replaced `hevy_client.py`, `exercise_mapper.py`, `fit_generator.py` with thin re-export wrappers from the published `hevy2garmin` PyPI package. `activity_replacer` uses hevy2garmin for FIT generation, upload, and rename. Added browser-based Garmin auth to the Next.js web app via the hevy2garmin Cloudflare Worker flow. Removed ~1073 lines of duplicate code.
- **garmin-auth package** ([#3](https://github.com/drkostas/soma/issues/3), [#1](https://github.com/drkostas/soma/pull/1)) — extracted the Garmin SSO + token storage layer into the standalone `garmin-auth` package. `sync/src/garmin_client.py` now imports `GarminAuth`. Removed duplicate Vercel SSO middleware. Bumped to `garmin-auth==0.2.1` for the cloud `expires_at` fix.

### Planned

- **run-dj** ([#4](https://github.com/drkostas/soma/issues/4)) — HR-driven Spotify song selection during runs. Extracted from `sync/src/dj_daemon.py`.
- **banister** ([#5](https://github.com/drkostas/soma/issues/5)) — Banister fitness/fatigue model, VDOT, readiness scoring, plan generation. Extracted from `sync/src/training_engine/`.
- **macro-engine** ([#6](https://github.com/drkostas/soma/issues/6)) — TDEE, carb periodization, meal slot distribution. Extracted from `sync/src/nutrition_engine/`.

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
