"""Backfill Garmin activities with rich descriptions and workout images.

Finds hevy workouts that have been uploaded to Garmin (via workout_enrichment.garmin_activity_id),
generates descriptions and images, and updates them on Garmin Connect.

Usage:
    # Update the latest workout (test run):
    python3 garmin_backfill.py --latest

    # Update all workouts:
    python3 garmin_backfill.py --all

    # Update a specific hevy_id:
    python3 garmin_backfill.py --id <hevy_id>

    # Description only (no image):
    python3 garmin_backfill.py --latest --no-image

    # Dry run (print descriptions, don't upload):
    python3 garmin_backfill.py --latest --dry-run
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
import urllib.request

from db import get_connection
from garmin_client import init_garmin, set_activity_description, upload_activity_image, API_CALL_DELAY
from strava_description import generate_description

logger = logging.getLogger(__name__)

# Web app base URL for fetching images
WEB_BASE_URL = "http://localhost:3456"


def _get_workouts(limit: int | None = None, hevy_id: str | None = None) -> list[dict]:
    """Get hevy workouts that have garmin_activity_id."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            if hevy_id:
                cur.execute("""
                    SELECT we.hevy_id, we.garmin_activity_id, we.hevy_title,
                           h.raw_json,
                           we.avg_hr, we.max_hr, we.calories, we.duration_s,
                           we.hr_samples, we.hr_source
                    FROM workout_enrichment we
                    JOIN hevy_raw_data h ON h.hevy_id = we.hevy_id AND h.endpoint_name = 'workout'
                    WHERE we.garmin_activity_id IS NOT NULL
                      AND we.hevy_id = %s
                    LIMIT 1
                """, (hevy_id,))
            else:
                q = """
                    SELECT we.hevy_id, we.garmin_activity_id, we.hevy_title,
                           h.raw_json,
                           we.avg_hr, we.max_hr, we.calories, we.duration_s,
                           we.hr_samples, we.hr_source
                    FROM workout_enrichment we
                    JOIN hevy_raw_data h ON h.hevy_id = we.hevy_id AND h.endpoint_name = 'workout'
                    WHERE we.garmin_activity_id IS NOT NULL
                    ORDER BY we.workout_date DESC
                """
                if limit:
                    q += f" LIMIT {limit}"
                cur.execute(q)

            rows = cur.fetchall()

    results = []
    for row in rows:
        raw = json.loads(row[3]) if isinstance(row[3], str) else row[3]
        results.append({
            "hevy_id": row[0],
            "garmin_activity_id": row[1],
            "title": row[2],
            "raw_json": raw,
            "enrichment": {
                "avg_hr": row[4],
                "max_hr": row[5],
                "calories": row[6],
                "duration_s": row[7],
            },
            "hr_samples": row[8] if isinstance(row[8], list) else [],
            "hr_source": row[9],
        })
    return results


def _fetch_image(hevy_id: str) -> bytes | None:
    """Fetch workout image from the web app API."""
    # The image endpoint uses the Hevy workout ID from raw_json->>'id'
    url = f"{WEB_BASE_URL}/api/workout/{hevy_id}/image"
    try:
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=30) as resp:
            if resp.status == 200:
                return resp.read()
            logger.warning("Image endpoint returned %d for %s", resp.status, hevy_id)
            return None
    except Exception as e:
        logger.warning("Failed to fetch image for %s: %s", hevy_id, e)
        return None


def _api_call_with_retry(func, *args, max_retries=3, **kwargs):
    """Call a function with retry on rate limiting."""
    for attempt in range(max_retries):
        try:
            return func(*args, **kwargs)
        except Exception as e:
            err_str = str(e)
            if "429" in err_str or "Too Many" in err_str:
                wait = (attempt + 1) * 30
                print(f"    Rate limited, waiting {wait}s...")
                time.sleep(wait)
                continue
            raise
    raise RuntimeError(f"Max retries ({max_retries}) exceeded")


def backfill_garmin(
    client,
    workouts: list[dict],
    include_image: bool = True,
    dry_run: bool = False,
) -> dict:
    """Generate and apply descriptions + images to Garmin activities."""
    stats = {"desc_ok": 0, "img_ok": 0, "desc_fail": 0, "img_fail": 0, "img_skip": 0}

    for i, w in enumerate(workouts):
        hevy_id = w["hevy_id"]
        garmin_id = w["garmin_activity_id"]
        title = w["title"]
        hr_samples = w["hr_samples"] if w["hr_source"] == "daily" else None

        desc = generate_description(hevy_id, w["raw_json"], w["enrichment"], hr_samples)

        print(f"\n[{i+1}/{len(workouts)}] {hevy_id} -> garmin:{garmin_id} ({title})", flush=True)

        if dry_run:
            print(f"  [DRY RUN] Description ({len(desc)} chars):")
            print(f"  {desc[:120]}...")
            if include_image:
                print(f"  [DRY RUN] Would fetch image from {WEB_BASE_URL}/api/workout/{hevy_id}/image")
            stats["desc_ok"] += 1
            continue

        # Update description
        try:
            _api_call_with_retry(set_activity_description, client, int(garmin_id), desc)
            print(f"  Description updated", flush=True)
            stats["desc_ok"] += 1
        except Exception as e:
            print(f"  Description FAILED: {e}", flush=True)
            stats["desc_fail"] += 1

        # Upload image
        if include_image:
            image_bytes = _fetch_image(hevy_id)
            if image_bytes:
                try:
                    _api_call_with_retry(upload_activity_image, client, int(garmin_id), image_bytes)
                    print(f"  Image uploaded ({len(image_bytes) // 1024}KB)", flush=True)
                    stats["img_ok"] += 1
                except Exception as e:
                    print(f"  Image FAILED: {e}", flush=True)
                    stats["img_fail"] += 1
            else:
                print(f"  Image skipped (fetch failed)", flush=True)
                stats["img_skip"] += 1

        # Rate limit between activities
        time.sleep(3)

    return stats


def main():
    parser = argparse.ArgumentParser(description="Backfill Garmin activities with descriptions + images")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--latest", action="store_true", help="Update the most recent workout")
    group.add_argument("--all", action="store_true", help="Update all workouts")
    group.add_argument("--id", type=str, help="Update a specific hevy_id")
    parser.add_argument("--no-image", action="store_true", help="Skip image upload")
    parser.add_argument("--dry-run", action="store_true", help="Print without updating Garmin")
    parser.add_argument("--skip", type=int, default=0, help="Skip first N workouts (for resuming)")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(message)s")

    print("=== Garmin Description + Image Backfill ===\n")

    if args.latest:
        workouts = _get_workouts(limit=1)
    elif args.id:
        workouts = _get_workouts(hevy_id=args.id)
    else:
        workouts = _get_workouts()

    if not workouts:
        print("No workouts found with Garmin activity IDs.")
        return

    if args.skip:
        workouts = workouts[args.skip:]
        print(f"Found {len(workouts)} workout(s) (skipped {args.skip}).")
    else:
        print(f"Found {len(workouts)} workout(s).")

    if args.dry_run:
        backfill_garmin(None, workouts, include_image=not args.no_image, dry_run=True)
        return

    print("Authenticating with Garmin Connect...")
    client = init_garmin()
    print("Authenticated.\n")

    stats = backfill_garmin(client, workouts, include_image=not args.no_image)

    print(f"\n=== Done ===")
    print(f"Descriptions: {stats['desc_ok']} ok, {stats['desc_fail']} failed")
    if not args.no_image:
        print(f"Images: {stats['img_ok']} ok, {stats['img_fail']} failed, {stats['img_skip']} skipped")


if __name__ == "__main__":
    main()
