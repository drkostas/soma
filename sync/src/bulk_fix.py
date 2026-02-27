"""Bulk fix workout weights and propagate descriptions everywhere.

Applies weight adjustments to specified exercises across all workouts,
then regenerates descriptions and pushes to Hevy, Garmin, and Strava.

Usage:
    # Dry run — show what would change:
    python -m src.bulk_fix --dry-run

    # Apply fixes to DB + Hevy, regenerate descriptions, push to Garmin + Strava:
    python -m src.bulk_fix --apply

    # Only regenerate descriptions (no weight fixes, just recompute PRs oldest→newest):
    python -m src.bulk_fix --regen-only
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import time
from datetime import datetime, timezone

from db import get_connection
from strava_description import generate_description
from config import HEVY_API_KEY

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# BENCH PRESS: workout IDs to exclude from specific fix rules
# ---------------------------------------------------------------------------
# Add workout UUIDs here if they should be skipped for a particular exercise fix.
BENCH_EXCLUDE_WORKOUT_IDS: set[str] = set()

# ---------------------------------------------------------------------------
# WEIGHT FIX RULES
# ---------------------------------------------------------------------------
# Each rule: exercise title, field, transform function, optional condition
# Transform receives (weight_value, workout_json) and returns new value.
# Return None to skip a set.
#
# Example — add bar weight to all barbell bench press sets:
#   {"exercise": "Bench Press (Barbell)", "field": "weight_kg",
#    "transform": lambda w, _wk: w + 20},

FIXES: list[dict] = []


# ---------------------------------------------------------------------------
# EXERCISE MERGES (rename title + template_id)
# ---------------------------------------------------------------------------
# Example — rename an exercise across all workouts:
#   {
#       "from_title": "Deadlift (Barbell)",
#       "from_template_id": "C6272009",
#       "to_title": "Romanian Deadlift (Barbell)",
#       "to_template_id": "2B4B7310",
#   },

MERGES: list[dict] = []


# ---------------------------------------------------------------------------
# Fix application
# ---------------------------------------------------------------------------

def _apply_fixes_to_workout(workout_json: dict) -> tuple[dict, list[dict]]:
    """Apply FIXES rules and MERGES to a workout. Returns (modified_json, list_of_changes).

    Each change dict: {exercise, set_index, field, old, new, change_type}
    """
    changes = []
    workout_id = workout_json.get("id", "")

    for ex in workout_json.get("exercises", []):
        ex_title = ex.get("title", "")

        # --- Exercise merges (rename title + template_id) ---
        for merge in MERGES:
            if ex_title == merge["from_title"]:
                changes.append({
                    "exercise": ex_title,
                    "set_index": -1,
                    "field": "title",
                    "old": merge["from_title"],
                    "new": merge["to_title"],
                    "change_type": "merge",
                })
                ex["title"] = merge["to_title"]
                ex["exercise_template_id"] = merge["to_template_id"]
                ex_title = merge["to_title"]
                break

        # --- Weight fixes ---
        for fix in FIXES:
            if fix["exercise"] != ex_title:
                continue

            # Skip bench press for excluded workouts
            if ex_title == "Bench Press (Barbell)" and workout_id in BENCH_EXCLUDE_WORKOUT_IDS:
                continue

            field = fix["field"]
            for i, s in enumerate(ex.get("sets", [])):
                old_val = s.get(field)
                if old_val is None:
                    continue
                new_val = fix["transform"](old_val, workout_json)
                if new_val is None or new_val == old_val:
                    continue
                changes.append({
                    "exercise": ex_title,
                    "set_index": i,
                    "field": field,
                    "old": old_val,
                    "new": round(new_val, 1),
                    "change_type": "weight",
                })
                s[field] = round(new_val, 1)

    return workout_json, changes


def _update_hevy(workout_id: str, workout_json: dict) -> bool:
    """PUT the modified workout back to Hevy API."""
    if not HEVY_API_KEY:
        print("    Hevy: skipped (no HEVY_API_KEY)")
        return False

    import requests as _requests

    put_body = {
        "workout": {
            "title": workout_json.get("title"),
            "description": workout_json.get("description") or None,
            "start_time": workout_json.get("start_time"),
            "end_time": workout_json.get("end_time"),
            "is_private": False,
            "exercises": [
                {
                    "exercise_template_id": ex.get("exercise_template_id"),
                    "superset_id": ex.get("superset_id") or None,
                    "notes": ex.get("notes") or None,
                    "sets": [
                        {
                            "type": s.get("type"),
                            "weight_kg": s.get("weight_kg"),
                            "reps": s.get("reps"),
                            "distance_meters": s.get("distance_meters"),
                            "duration_seconds": s.get("duration_seconds"),
                            "rpe": s.get("rpe"),
                        }
                        for s in ex.get("sets", [])
                    ],
                }
                for ex in workout_json.get("exercises", [])
            ],
        },
    }

    try:
        resp = _requests.put(
            f"https://api.hevyapp.com/v1/workouts/{workout_id}",
            json=put_body,
            headers={"api-key": HEVY_API_KEY},
            timeout=15,
        )
        if resp.status_code == 200:
            return True
        print(f"    Hevy: HTTP {resp.status_code}")
        return False
    except Exception as e:
        print(f"    Hevy: {e}")
        return False


# ---------------------------------------------------------------------------
# Description regeneration + push
# ---------------------------------------------------------------------------

def _get_all_workouts_chronological() -> list[dict]:
    """Fetch all hevy workouts with enrichment data, oldest first."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT h.hevy_id, h.raw_json,
                       we.avg_hr, we.max_hr, we.calories, we.duration_s,
                       we.hr_samples, we.hr_source, we.garmin_activity_id
                FROM hevy_raw_data h
                LEFT JOIN workout_enrichment we ON we.hevy_id = h.hevy_id
                WHERE h.endpoint_name = 'workout'
                ORDER BY h.raw_json->>'start_time' ASC
            """)
            rows = cur.fetchall()

    results = []
    for row in rows:
        raw = json.loads(row[1]) if isinstance(row[1], str) else row[1]
        results.append({
            "hevy_id": row[0],
            "raw_json": raw,
            "enrichment": {
                "avg_hr": row[2],
                "max_hr": row[3],
                "calories": row[4],
                "duration_s": row[5],
            },
            "hr_samples": row[6] if isinstance(row[6], list) else [],
            "hr_source": row[7],
            "garmin_activity_id": row[8],
        })
    return results


def _find_strava_id(hevy_id: str) -> str | None:
    """Find the Strava activity ID for a hevy workout (sent or external)."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT destination_id FROM activity_sync_log
                WHERE source_platform = 'hevy' AND source_id = %s
                  AND destination = 'strava' AND status IN ('sent', 'external')
                LIMIT 1
            """, (hevy_id,))
            row = cur.fetchone()
            return row[0] if row else None


def regenerate_and_push(
    workouts: list[dict],
    strava_client=None,
    garmin_client=None,
    dry_run: bool = False,
) -> dict:
    """Regenerate descriptions for all workouts (oldest→newest) and push.

    Returns summary dict with counts.
    """
    from garmin_client import set_activity_description

    stats = {"total": len(workouts), "descriptions": 0, "strava": 0, "garmin": 0, "errors": 0}

    for i, w in enumerate(workouts):
        hevy_id = w["hevy_id"]
        raw = w["raw_json"]
        title = raw.get("title", "Workout")
        start = raw.get("start_time", "")
        hr_samples = w["hr_samples"] if w["hr_source"] == "daily" else None

        desc = generate_description(hevy_id, raw, w["enrichment"], hr_samples)
        stats["descriptions"] += 1

        if dry_run:
            if i < 3 or i == len(workouts) - 1:
                print(f"\n{'='*50}")
                print(f"[{i+1}/{len(workouts)}] {title} ({start[:10]})")
                print(f"{'='*50}")
                print(desc[:300] + ("..." if len(desc) > 300 else ""))
            elif i == 3:
                print(f"\n  ... ({len(workouts) - 4} more workouts) ...\n")
            continue

        # Push to Strava
        strava_id = _find_strava_id(hevy_id)
        if strava_id and strava_client:
            for attempt in range(3):
                try:
                    strava_client.update_activity(int(strava_id), description=desc)
                    stats["strava"] += 1
                    break
                except Exception as e:
                    if ("429" in str(e) or "Too Many" in str(e)) and attempt < 2:
                        wait = (attempt + 1) * 60
                        print(f"    Strava rate limited, waiting {wait}s...")
                        time.sleep(wait)
                        continue
                    print(f"    Strava error: {e}")
                    stats["errors"] += 1
                    break

        # Push to Garmin
        garmin_id = w.get("garmin_activity_id")
        if garmin_id and garmin_client:
            try:
                set_activity_description(garmin_client, int(garmin_id), desc)
                stats["garmin"] += 1
            except Exception as e:
                print(f"    Garmin error: {e}")
                stats["errors"] += 1

        # Rate limit: ~9s between Strava calls
        if strava_id and strava_client:
            time.sleep(10)
        elif garmin_id and garmin_client:
            time.sleep(1)

        if (i + 1) % 25 == 0:
            print(f"  [{i+1}/{len(workouts)}] {title} — strava:{stats['strava']}, garmin:{stats['garmin']}")

    return stats


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Bulk fix weights + regenerate descriptions")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--dry-run", action="store_true", help="Show changes without applying")
    group.add_argument("--apply", action="store_true", help="Apply fixes + regenerate + push")
    group.add_argument("--regen-only", action="store_true", help="Only regenerate descriptions (no weight fixes)")
    parser.add_argument("--skip-strava", action="store_true", help="Skip Strava updates")
    parser.add_argument("--skip-garmin", action="store_true", help="Skip Garmin updates")
    parser.add_argument("--skip-hevy", action="store_true", help="Skip Hevy API updates")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(message)s")

    print("=== Bulk Fix & Description Regeneration ===\n")

    # Step 1: Load all workouts chronologically
    workouts = _get_all_workouts_chronological()
    print(f"Loaded {len(workouts)} workouts (oldest→newest)\n")

    # Step 2: Apply weight fixes + merges (unless regen-only)
    if not args.regen_only and (FIXES or MERGES):
        fix_count = 0
        merge_count = 0
        fixed_ids = set()
        for w in workouts:
            raw, changes = _apply_fixes_to_workout(w["raw_json"])
            if changes:
                w["raw_json"] = raw
                fixed_ids.add(w["hevy_id"])
                weight_changes = [c for c in changes if c["change_type"] == "weight"]
                merge_changes = [c for c in changes if c["change_type"] == "merge"]
                fix_count += len(weight_changes)
                merge_count += len(merge_changes)

                title = raw.get("title", "Workout")
                date = raw.get("start_time", "")[:10]
                if args.dry_run:
                    print(f"  {title} ({date}):")
                    for c in merge_changes:
                        print(f"    MERGE: {c['old']} → {c['new']}")
                    for c in weight_changes:
                        print(f"    {c['exercise']} set#{c['set_index']+1}: {c['field']} {c['old']} → {c['new']}")

        print(f"\nWeight fixes: {fix_count} sets across {len(fixed_ids)} workouts")
        print(f"Exercise merges: {merge_count} exercises renamed")

        if args.apply and fixed_ids:
            print(f"\nApplying fixes to DB + Hevy ({len(fixed_ids)} workouts)...")
            applied = 0
            for w in workouts:
                if w["hevy_id"] not in fixed_ids:
                    continue
                raw = w["raw_json"]
                workout_id = raw.get("id", w["hevy_id"])
                title = raw.get("title", "Workout")

                # Update our DB
                with get_connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute("""
                            UPDATE hevy_raw_data
                            SET raw_json = %s::jsonb
                            WHERE endpoint_name = 'workout' AND hevy_id = %s
                        """, (json.dumps(raw), w["hevy_id"]))

                # Update Hevy
                if not args.skip_hevy:
                    ok = _update_hevy(workout_id, raw)
                    applied += 1
                    if applied % 10 == 0 or applied == len(fixed_ids):
                        print(f"  [{applied}/{len(fixed_ids)}] {title}: DB ✓, Hevy {'✓' if ok else '✗'}")
                    time.sleep(1)  # Hevy rate limit
                else:
                    applied += 1
                    if applied % 10 == 0 or applied == len(fixed_ids):
                        print(f"  [{applied}/{len(fixed_ids)}] {title}: DB ✓, Hevy skipped")

    elif not args.regen_only:
        print("No FIXES or MERGES defined.\n")

    if args.dry_run:
        print("\n--- Description preview (oldest→newest) ---")
        regenerate_and_push(workouts, dry_run=True)
        print("\nDry run complete. Use --apply to execute.")
        return

    # Step 3: Regenerate descriptions and push
    print("\nRegenerating descriptions (oldest→newest)...")

    strava_client = None
    garmin_client = None

    if not args.skip_strava:
        try:
            from strava_backfill import _get_strava_client
            strava_client = _get_strava_client()
            print("  Strava: connected")
        except Exception as e:
            print(f"  Strava: unavailable ({e})")

    if not args.skip_garmin:
        try:
            from garmin_client import init_garmin
            garmin_client = init_garmin()
            print("  Garmin: connected")
        except Exception as e:
            print(f"  Garmin: unavailable ({e})")

    stats = regenerate_and_push(workouts, strava_client, garmin_client)
    print(f"\nDone. Descriptions: {stats['descriptions']}, "
          f"Strava: {stats['strava']}, Garmin: {stats['garmin']}, "
          f"Errors: {stats['errors']}")


if __name__ == "__main__":
    main()
