"""Backfill Strava activities with rich descriptions.

Finds hevy workouts already synced to Strava (via activity_sync_log),
generates descriptions, and updates them via Strava API.

Usage:
    # Update the latest synced activity (test run):
    python -m src.strava_backfill --latest

    # Update all synced activities:
    python -m src.strava_backfill --all

    # Update a specific hevy_id:
    python -m src.strava_backfill --id <hevy_id>
"""

from __future__ import annotations

import argparse
import json
import logging
import sys

from db import get_connection, get_platform_credentials, upsert_platform_credentials
from strava_client import StravaClient
from strava_description import generate_description

logger = logging.getLogger(__name__)


def _get_strava_client() -> StravaClient:
    """Get an authenticated Strava client, refreshing tokens if needed."""
    with get_connection() as conn:
        creds = get_platform_credentials(conn, "strava")
    if not creds or creds["status"] != "active":
        raise RuntimeError("Strava not connected. Set up credentials first.")

    tokens = creds["credentials"]
    client = StravaClient(
        access_token=tokens["access_token"],
        refresh_token=tokens["refresh_token"],
    )

    from datetime import datetime, timezone
    new_tokens = client.refresh_tokens()
    expires_epoch = new_tokens.get("expires_at")
    expires_dt = (
        datetime.fromtimestamp(expires_epoch, tz=timezone.utc)
        if expires_epoch else None
    )
    with get_connection() as conn:
        upsert_platform_credentials(
            conn, "strava", "oauth2",
            {**tokens, "access_token": new_tokens["access_token"],
             "refresh_token": new_tokens["refresh_token"]},
            expires_at=expires_dt,
        )

    return client


def _get_synced_workouts(limit: int | None = None, hevy_id: str | None = None) -> list[dict]:
    """Get hevy workouts that are on Strava (via any path).

    Uses timestamp matching (±24h + name) to find Strava activities
    corresponding to each hevy workout, since they may have arrived
    via garmin native sync, direct push, or other paths.
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            # Get hevy workouts with enrichment data
            hevy_filter = ""
            params: list = []
            if hevy_id:
                hevy_filter = "AND h.hevy_id = %s"
                params.append(hevy_id)

            cur.execute(f"""
                SELECT h.hevy_id, h.raw_json,
                       we.avg_hr, we.max_hr, we.calories, we.duration_s,
                       we.hr_samples, we.hr_source
                FROM hevy_raw_data h
                LEFT JOIN workout_enrichment we ON we.hevy_id = h.hevy_id
                WHERE h.endpoint_name = 'workout'
                  {hevy_filter}
                ORDER BY h.raw_json->>'start_time' DESC
            """, params)
            hevy_rows = cur.fetchall()

            # Get all Strava WeightTraining activities
            cur.execute("""
                SELECT strava_id, raw_json->>'start_date' as start_date,
                       raw_json->>'name' as name
                FROM strava_raw_data
                WHERE endpoint_name = 'activity'
                  AND raw_json->>'type' = 'WeightTraining'
            """)
            strava_rows = cur.fetchall()

    # Build Strava lookup by timestamp
    from datetime import datetime, timezone, timedelta
    strava_by_epoch: list[tuple[float, str, str]] = []  # (epoch, strava_id, name)
    for sid, start_date, name in strava_rows:
        if not start_date:
            continue
        try:
            dt = datetime.fromisoformat(start_date.replace("Z", "+00:00"))
            strava_by_epoch.append((dt.timestamp(), str(sid), name or ""))
        except (ValueError, TypeError):
            pass

    results = []
    for row in hevy_rows:
        raw = json.loads(row[1]) if isinstance(row[1], str) else row[1]
        hevy_start = raw.get("start_time", "")
        hevy_title = raw.get("title", "")
        if not hevy_start:
            continue

        try:
            hdt = datetime.fromisoformat(hevy_start.replace("Z", "+00:00"))
            h_epoch = hdt.timestamp()
        except (ValueError, TypeError):
            continue

        # Match: ±120s first, then name+day fallback
        best_strava_id = None
        best_diff = float("inf")
        for s_epoch, sid, s_name in strava_by_epoch:
            diff = abs(s_epoch - h_epoch)
            if diff <= 120 and diff < best_diff:
                best_diff = diff
                best_strava_id = sid

        if not best_strava_id:
            for s_epoch, sid, s_name in strava_by_epoch:
                diff = abs(s_epoch - h_epoch)
                if diff <= 86400 and s_name == hevy_title:
                    best_strava_id = sid
                    break

        if not best_strava_id:
            continue

        results.append({
            "hevy_id": row[0],
            "strava_activity_id": best_strava_id,
            "raw_json": raw,
            "enrichment": {
                "avg_hr": row[2],
                "max_hr": row[3],
                "calories": row[4],
                "duration_s": row[5],
            },
            "hr_samples": row[6] if isinstance(row[6], list) else [],
            "hr_source": row[7],
        })

        if limit and len(results) >= limit:
            break

    return results


def backfill_descriptions(
    client: StravaClient,
    workouts: list[dict],
    dry_run: bool = False,
) -> int:
    """Generate and apply descriptions to synced Strava activities."""
    import time
    updated = 0
    for i, w in enumerate(workouts):
        hevy_id = w["hevy_id"]
        strava_id = w["strava_activity_id"]
        title = w["raw_json"].get("title", "Workout")
        hr_samples = w["hr_samples"] if w["hr_source"] == "daily" else None

        desc = generate_description(hevy_id, w["raw_json"], w["enrichment"], hr_samples)

        if dry_run:
            print(f"\n{'='*50}")
            print(f"[DRY RUN] {hevy_id} -> strava:{strava_id} ({title})")
            print(f"{'='*50}")
            print(desc)
            print()
            updated += 1
            continue

        for attempt in range(3):
            try:
                client.update_activity(int(strava_id), description=desc)
                print(f"  [{i+1}/{len(workouts)}] Updated strava:{strava_id} ({title})", flush=True)
                updated += 1
                break
            except Exception as e:
                err_str = str(e)
                if ("429" in err_str or "Too Many" in err_str) and attempt < 2:
                    wait = (attempt + 1) * 60
                    print(f"  Rate limited, waiting {wait}s...", flush=True)
                    time.sleep(wait)
                    continue
                print(f"  FAILED strava:{strava_id} ({title}): {e}", flush=True)
                break

        # Strava has 100 req/15min limit — ~9s between calls
        time.sleep(10)

    return updated


def main():
    parser = argparse.ArgumentParser(description="Backfill Strava activity descriptions")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--latest", action="store_true", help="Update the most recently synced activity")
    group.add_argument("--all", action="store_true", help="Update all synced activities")
    group.add_argument("--id", type=str, help="Update a specific hevy_id")
    parser.add_argument("--dry-run", action="store_true", help="Print descriptions without updating Strava")
    parser.add_argument("--skip", type=int, default=0, help="Skip first N workouts (for resuming)")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(message)s")

    print("=== Strava Description Backfill ===\n")

    if args.latest:
        workouts = _get_synced_workouts(limit=1)
    elif args.id:
        workouts = _get_synced_workouts(hevy_id=args.id)
    else:
        workouts = _get_synced_workouts()

    if not workouts:
        print("No synced workouts found.")
        return

    if args.skip:
        workouts = workouts[args.skip:]
        print(f"Found {len(workouts)} workout(s) to update (skipped {args.skip}).\n")
    else:
        print(f"Found {len(workouts)} workout(s) to update.\n")

    if args.dry_run:
        backfill_descriptions(None, workouts, dry_run=True)
        return

    client = _get_strava_client()
    count = backfill_descriptions(client, workouts)
    print(f"\nDone. Updated {count}/{len(workouts)} activities.")


if __name__ == "__main__":
    main()
