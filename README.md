<div align="center">
  <br>
  <img src="soma-icon.png" width="60" alt="soma" />
  <br><br>
  <h2>soma</h2>
  <p>Your health stack, finally unified.<br>
  Garmin · Hevy · Strava — one self-hosted dashboard, your data, your server.</p>
  <br>

  [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fdrkostas%2Fsoma&root-directory=web&env=DATABASE_URL,STRAVA_CLIENT_ID,STRAVA_CLIENT_SECRET,NEXT_PUBLIC_BASE_URL&envDescription=See%20the%20setup%20guide&envLink=https%3A%2F%2Fgithub.com%2Fdrkostas%2Fsoma%23setup)

  <br>

  [![License: MIT](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)](./LICENSE)
  [![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=next.js)](https://nextjs.org)
  [![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?style=flat-square&logo=python&logoColor=white)](https://python.org)
  [![Postgres](https://img.shields.io/badge/Neon-PostgreSQL-00E5BF?style=flat-square&logo=postgresql&logoColor=white)](https://neon.tech)

  <br><br>
</div>

---

## Overview

Daily steps, resting heart rate, stress trend, body composition, recovery status, weekly training load, activity streaks — your full health picture on one page.

<img src="docs/screenshots/overview.png" width="100%" alt="Daily steps · Resting heart rate · Stress trend" />

---

## Running

Pace progression across every run, monthly mileage history, VO2max trend, training zones, HR vs pace scatter, split analysis, shoe mileage tracking.

<img src="docs/screenshots/running.png" width="100%" alt="Running — 2926 km across 456 runs · Pace progression · Monthly mileage" />

---

## Workouts

Muscle activation map (front & back) with volume by muscle group across all sessions. Exercise progression, personal records, gym frequency heatmap.

<img src="docs/screenshots/workouts.png" width="100%" alt="Muscle activation map · Volume by muscle group across 266 sessions" />

---

## Sleep & Recovery

Sleep stages over time (deep, light, REM, awake), score trend, sleep schedule, HRV, blood oxygen, respiration rate, body battery, training readiness.

<img src="docs/screenshots/sleep.png" width="100%" alt="Sleep stages · Score trend across 1538 nights" />

---

## Sync Hub

See exactly what synced, configure push rules (e.g. Hevy strength → Strava), and monitor the live data pipeline.

<img src="docs/screenshots/connections.png" width="100%" alt="Sync hub — Garmin and Hevy ingest, push to Strava · Telegram · Garmin" />

---

## Architecture

```
Garmin Connect ──┐
                 ├──▶  sync/ (Python, hourly)  ──▶  Neon PostgreSQL  ◀──  web/ (Next.js)  ──▶  Vercel
Hevy API ────────┘                                                                │
                                                                                  ▼
                                                                             Strava (push)
```

`sync/` writes. `web/` reads. That boundary never crosses.

---

## Setup

### Prerequisites

| Service | Required | Notes |
|---|---|---|
| [Neon](https://neon.tech) | ✓ | Free tier works |
| Garmin Connect | ✓ | Any Garmin device |
| [Hevy Pro](https://hevy.com) | optional | Strength workouts |
| [Strava API app](https://www.strava.com/settings/api) | optional | Activity push |

### 1 — Database

```bash
psql "$DATABASE_URL" -f sync/schema.sql
```

### 2 — Web app

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fdrkostas%2Fsoma&root-directory=web&env=DATABASE_URL,STRAVA_CLIENT_ID,STRAVA_CLIENT_SECRET,NEXT_PUBLIC_BASE_URL&envDescription=See%20the%20setup%20guide&envLink=https%3A%2F%2Fgithub.com%2Fdrkostas%2Fsoma%23setup)

Set **Root Directory → `web`** in Vercel, then add:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon connection string |
| `STRAVA_CLIENT_ID` | From your Strava API settings |
| `STRAVA_CLIENT_SECRET` | From your Strava API settings |
| `NEXT_PUBLIC_BASE_URL` | Your Vercel URL |

Then visit `/connections` to complete Strava OAuth.

### 3 — Sync engine

<details>
<summary><strong>GitHub Actions</strong> (recommended — free, runs in the cloud)</summary>
<br>

Add to your fork under **Settings → Secrets → Actions**:

| Secret | Value |
|---|---|
| `DATABASE_URL` | Neon connection string |
| `GARMIN_EMAIL` | Garmin Connect email |
| `GARMIN_PASSWORD` | Garmin Connect password |
| `HEVY_API_KEY` | Hevy API key *(Pro required)* |
| `STRAVA_CLIENT_ID` | Strava client ID |
| `STRAVA_CLIENT_SECRET` | Strava client secret |
| `TELEGRAM_BOT_TOKEN` | *(optional)* |
| `TELEGRAM_CHAT_ID` | *(optional)* |

Runs hourly via [`.github/workflows/sync.yml`](.github/workflows/sync.yml). Trigger manually from the **Actions** tab anytime.

</details>

<details>
<summary><strong>Local cron</strong> (for home servers)</summary>
<br>

```bash
cd sync
python3 -m venv .venv && .venv/bin/pip install -e .
cp ../.env.example ../.env   # fill in credentials
bash cron-setup.sh           # installs hourly cron
```

</details>

---

## Development

```bash
cd web && npm install && npm run dev    # → http://localhost:3456
cd sync && python -m src.pipeline      # manual sync run
```

---

## License

[MIT](./LICENSE)

---

<div align="center">
  <sub>Built for athletes who want to understand their data, not just collect it.</sub>
</div>
