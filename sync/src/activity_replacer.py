"""Convert Hevy workouts to FIT files and upload to Garmin Connect.

Workflow:
  1. Fetch all Hevy workouts from the database
  2. For each, extract HR samples from Garmin daily monitoring
  3. If no HR, use avg from last 10 workouts with HR (or static 90 bpm)
  4. Generate FIT file with HR + Keytel-formula calories
  5. Upload to Garmin Connect and rename
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from config import DATABASE_URL
from db import get_connection, upsert_workout_enrichment, get_outlier_workouts
from fit_generator import generate_fit

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
DEFAULT_BACKUP_DIR = str(Path(__file__).resolve().parents[1] / "backups")
DEFAULT_FIT_DIR = str(Path(__file__).resolve().parents[1] / "fit_output")
_FALLBACK_HR_WINDOW = 10  # use avg of last N workouts with HR as fallback
_MIN_EXERCISE_HR = 65  # below this, daily HR is likely resting, not exercise


# ---------------------------------------------------------------------------
# Database queries
# ---------------------------------------------------------------------------

def get_all_hevy_workouts(conn, hevy_id=None) -> list[dict]:
    """Fetch all Hevy workouts from the database.

    Returns list of dicts with hevy_id, hevy_title, hevy_workout, date.
    """
    params: list = []
    hevy_filter = ""
    if hevy_id is not None:
        hevy_filter = "AND h.raw_json->>'id' = %s"
        params.append(str(hevy_id))

    query = f"""
    SELECT
        h.raw_json->>'id' AS hevy_id,
        h.raw_json->>'title' AS hevy_title,
        h.raw_json AS hevy_workout
    FROM hevy_raw_data h
    WHERE h.endpoint_name = 'workout'
      {hevy_filter}
    ORDER BY h.raw_json->>'start_time' DESC
    """
    with conn.cursor() as cur:
        cur.execute(query, params)
        rows = cur.fetchall()

    workouts = []
    for row in rows:
        hevy_workout = row[2]
        if isinstance(hevy_workout, str):
            hevy_workout = json.loads(hevy_workout)
        start_time = hevy_workout.get("start_time", "")
        date_str = start_time[:10] if start_time else "unknown"
        workouts.append({
            "hevy_id": row[0],
            "hevy_title": row[1],
            "hevy_workout": hevy_workout,
            "date": date_str,
        })
    return workouts


def get_daily_hr_for_window(conn, start_utc: str, end_utc: str) -> list[int]:
    """Extract HR samples from Garmin daily monitoring during a time window.

    Searches the day before, same day, and day after (UTC date) to handle
    timezone offsets. Returns list of HR values (ints) during the window.
    """
    start_dt = datetime.fromisoformat(start_utc.replace("Z", "+00:00"))
    end_dt = datetime.fromisoformat(end_utc.replace("Z", "+00:00"))
    start_ms = int(start_dt.timestamp() * 1000)
    end_ms = int(end_dt.timestamp() * 1000)

    workout_date = start_dt.date()
    dates_to_check = [
        workout_date - timedelta(days=1),
        workout_date,
        workout_date + timedelta(days=1),
    ]

    placeholders = ",".join(["%s"] * len(dates_to_check))
    query = f"""
    SELECT raw_json FROM garmin_raw_data
    WHERE endpoint_name = 'heart_rates' AND date IN ({placeholders})
    """
    with conn.cursor() as cur:
        cur.execute(query, dates_to_check)
        rows = cur.fetchall()

    hr_values = []
    for (raw,) in rows:
        if isinstance(raw, str):
            raw = json.loads(raw)
        for entry in raw.get("heartRateValues") or []:
            if (
                isinstance(entry, (list, tuple))
                and len(entry) >= 2
                and entry[0] is not None
                and entry[1] is not None
                and start_ms <= entry[0] <= end_ms
            ):
                hr_values.append(int(entry[1]))

    return hr_values


def get_development_activity_ids(conn) -> list[int]:
    """Get all DEVELOPMENT-manufacturer strength activity IDs (our old uploads)."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT ga.activity_id
            FROM garmin_activity_raw ga
            WHERE ga.endpoint_name = 'summary'
              AND ga.raw_json->'activityType'->>'typeKey' = 'strength_training'
              AND ga.raw_json->>'manufacturer' = 'DEVELOPMENT'
            ORDER BY ga.raw_json->>'startTimeGMT' DESC
        """)
        return [row[0] for row in cur.fetchall()]


def delete_old_uploads(garmin_client, conn, dry_run=False) -> int:
    """Delete all DEVELOPMENT-manufacturer strength activities from Garmin.

    These are our previous uploads that we're replacing with fresh FIT files.
    Skips real watch-recorded activities (GARMIN or null manufacturer).
    Returns count of deleted activities.
    """
    from garmin_client import rate_limited_call

    ids = get_development_activity_ids(conn)
    print(f"Found {len(ids)} DEVELOPMENT activities to delete")

    if dry_run:
        print("  DRY RUN - skipping deletion")
        return 0

    deleted = 0
    for i, aid in enumerate(ids, 1):
        print(f"  [{i}/{len(ids)}] Deleting activity {aid}...")
        try:
            rate_limited_call(garmin_client.delete_activity, str(aid))
            deleted += 1
        except Exception as e:
            print(f"    ERROR: {e}")

    print(f"  Deleted {deleted}/{len(ids)} activities")
    return deleted


# ---------------------------------------------------------------------------
# Manifest helpers
# ---------------------------------------------------------------------------

def load_manifest(backup_dir=DEFAULT_BACKUP_DIR) -> dict:
    """Load the processing manifest, returning {} if it doesn't exist."""
    path = os.path.join(backup_dir, "manifest.json")
    if not os.path.exists(path):
        return {}
    with open(path) as f:
        return json.load(f)


def save_manifest(manifest, backup_dir=DEFAULT_BACKUP_DIR):
    """Persist the processing manifest to disk."""
    os.makedirs(backup_dir, exist_ok=True)
    path = os.path.join(backup_dir, "manifest.json")
    with open(path, "w") as f:
        json.dump(manifest, f, indent=2)


# ---------------------------------------------------------------------------
# HR resolution
# ---------------------------------------------------------------------------

def resolve_hr_samples(
    conn, hevy_workout: dict, recent_hr_avgs: list[float]
) -> tuple[list[int], str]:
    """Resolve HR samples for a workout.

    1. Try Garmin daily HR monitoring during the workout window.
    2. If no data, use avg of last N workouts with HR.
    3. If still nothing, use static 90 bpm.

    Returns (hr_samples, source) where source is one of:
      "daily" - real HR from daily monitoring
      "avg_N"  - static HR from average of last N workouts
      "static" - fallback 90 bpm
    """
    start = hevy_workout.get("start_time", "")
    end = hevy_workout.get("end_time", "")

    if start and end:
        hr = get_daily_hr_for_window(conn, start, end)
        if hr:
            avg = sum(hr) / len(hr)
            if avg >= _MIN_EXERCISE_HR:
                return hr, "daily"
            # Daily HR too low (likely resting data), fall through to avg_N

    # Fallback: average from recent workouts with HR
    if len(recent_hr_avgs) >= 1:
        window = recent_hr_avgs[:_FALLBACK_HR_WINDOW]
        avg_hr = round(sum(window) / len(window))
        # Generate ~30 synthetic samples at the average HR
        return [avg_hr] * 30, f"avg_{len(window)}"

    # Ultimate fallback
    from fit_generator import _DEFAULT_HR_BPM
    return [_DEFAULT_HR_BPM] * 30, "static"


# ---------------------------------------------------------------------------
# Upload helpers
# ---------------------------------------------------------------------------

def _extract_activity_id(upload_resp) -> int | None:
    """Extract the Garmin activity ID from an upload response.

    The upload API returns a Response object. The JSON body has:
      detailedImportResult.successes[0].internalId
    Some uploads return successes immediately, others process async
    and only include uploadId/creationDate.
    """
    try:
        data = upload_resp.json() if hasattr(upload_resp, 'json') else upload_resp
        detail = data.get("detailedImportResult", {})
        successes = detail.get("successes", [])
        if successes:
            return successes[0]["internalId"]
        # Async processing — no successes yet. Not an error.
        if detail.get("uploadId"):
            print(f"    Upload accepted (async processing, uploadId={detail['uploadId']})")
    except Exception as e:
        resp_str = str(upload_resp)[:200] if upload_resp else "None"
        print(f"    Warning: could not parse upload response ({e}): {resp_str}")
    return None


def _find_recent_garmin_activity(garmin_client, workout: dict) -> int | None:
    """Find a just-uploaded activity on Garmin by matching timestamp.

    After async upload processing, the activity should appear in the user's
    recent activities list. Match by looking for a strength_training activity
    with manufacturer='DEVELOPMENT' (our FIT files) within ±120s of the
    Hevy workout start time.
    """
    from garmin_client import rate_limited_call

    hevy_start = workout.get("hevy_workout", {}).get("start_time", "")
    if not hevy_start:
        return None

    target_dt = datetime.fromisoformat(hevy_start).replace(tzinfo=None)

    try:
        activities = rate_limited_call(garmin_client.get_activities, 0, 5)
        for act in activities:
            start_gmt = act.get("startTimeGMT", "")
            if not start_gmt:
                continue
            try:
                act_dt = datetime.strptime(start_gmt, "%Y-%m-%d %H:%M:%S")
            except ValueError:
                continue
            if abs((act_dt - target_dt).total_seconds()) <= 120:
                return act.get("activityId")
    except Exception as e:
        print(f"    Warning: could not search recent activities: {e}")

    return None


# ---------------------------------------------------------------------------
# Enrichment persistence
# ---------------------------------------------------------------------------

def _save_enrichment(conn, workout: dict, hr_samples: list[int], hr_source: str,
                     fit_info: dict, garmin_activity_id: int | None = None,
                     status: str = "enriched"):
    """Persist enrichment data to the workout_enrichment table."""
    upsert_workout_enrichment(
        conn,
        hevy_id=workout["hevy_id"],
        garmin_activity_id=garmin_activity_id,
        hr_source=hr_source,
        avg_hr=fit_info.get("avg_hr"),
        max_hr=max(hr_samples) if hr_samples else None,
        min_hr=min(hr_samples) if hr_samples else None,
        hr_samples=hr_samples,
        hr_sample_count=len(hr_samples),
        calories=fit_info.get("calories"),
        duration_s=fit_info.get("duration_s"),
        exercise_count=fit_info.get("exercises"),
        total_sets=fit_info.get("total_sets"),
        hevy_title=workout.get("hevy_title"),
        workout_date=workout.get("date"),
        status=status,
    )


# ---------------------------------------------------------------------------
# Core orchestration
# ---------------------------------------------------------------------------

def process_workout(
    workout: dict,
    hr_samples: list[int],
    hr_source: str,
    garmin_client=None,
    dry_run: bool = False,
    fit_dir: str = DEFAULT_FIT_DIR,
    enrich_only: bool = False,
) -> dict:
    """Process a single Hevy workout: generate FIT and upload.

    Returns a result dict with status and details.
    """
    hevy_id = workout["hevy_id"]
    result = {
        "hevy_id": hevy_id,
        "date": workout.get("date", "unknown"),
        "status": "error",
    }

    try:
        # 1. Generate FIT
        fit_path = os.path.join(fit_dir, f"{hevy_id}.fit")
        fit_result = generate_fit(
            hevy_workout=workout["hevy_workout"],
            hr_samples=hr_samples,
            output_path=fit_path,
        )
        result["fit_path"] = fit_path
        result["fit_info"] = fit_result
        print(
            f"  Generated FIT: {fit_result['exercises']} exercises, "
            f"{fit_result['total_sets']} sets, "
            f"{fit_result['hr_samples']} HR samples ({hr_source}), "
            f"avg HR {fit_result['avg_hr']} bpm, "
            f"{fit_result['calories']} kcal"
        )

        # Save enrichment to DB (before upload, so data is preserved even on upload failure)
        with get_connection() as conn:
            _save_enrichment(conn, workout, hr_samples, hr_source, fit_result,
                             status="enriched")

        if enrich_only:
            result["status"] = "enriched"
            # Clean up FIT file since we're not uploading
            if os.path.exists(fit_path):
                os.remove(fit_path)
            return result

        if dry_run:
            result["status"] = "dry_run"
            print(f"  DRY RUN - skipping upload for {hevy_id}")
            return result

        # 2. Upload FIT
        print(f"  Uploading {fit_path}...")
        from garmin_client import rate_limited_call
        upload_resp = rate_limited_call(garmin_client.upload_activity, fit_path)

        # Extract activity ID from upload response
        new_id = _extract_activity_id(upload_resp)
        result["upload_result"] = str(upload_resp)

        # If async processing, wait and find by timestamp match
        if not new_id:
            import time as _time
            print(f"    Waiting 8s for Garmin to process upload...")
            _time.sleep(8)
            new_id = _find_recent_garmin_activity(garmin_client, workout)
            if new_id:
                print(f"    Found activity {new_id} via recent activity lookup")

        # 3. Rename activity to match Hevy workout title
        hevy_title = workout.get("hevy_title", "")
        if hevy_title and new_id:
            try:
                rate_limited_call(
                    garmin_client.set_activity_name, new_id, hevy_title
                )
                result["new_activity_id"] = new_id
                print(f"  Renamed activity {new_id} to '{hevy_title}'")
            except Exception as e:
                print(f"  Warning: could not rename activity: {e}")
        elif hevy_title:
            print(f"  Warning: could not extract activity ID from upload response")

        # Update enrichment status (direct UPDATE avoids INSERT NOT NULL issues)
        with get_connection() as conn:
            with conn.cursor() as cur:
                if new_id:
                    cur.execute(
                        """UPDATE workout_enrichment
                           SET garmin_activity_id = %s, status = 'uploaded', updated_at = NOW()
                           WHERE hevy_id = %s""",
                        (new_id, hevy_id),
                    )
                else:
                    cur.execute(
                        """UPDATE workout_enrichment
                           SET status = 'uploaded', updated_at = NOW()
                           WHERE hevy_id = %s""",
                        (hevy_id,),
                    )

        result["status"] = "uploaded"
        print(f"  Successfully uploaded activity for {hevy_id}")

    except Exception as e:
        result["status"] = "error"
        result["error"] = str(e)
        print(f"  ERROR processing {hevy_id}: {e}")

    return result


# ---------------------------------------------------------------------------
# Rename-only mode
# ---------------------------------------------------------------------------

def _rename_all_activities(args):
    """Match Garmin strength activities to Hevy workouts by timestamp and rename."""
    from garmin_client import init_garmin, rate_limited_call

    with get_connection() as conn:
        workouts = get_all_hevy_workouts(conn)

    print(f"Found {len(workouts)} Hevy workouts")

    # Build lookup: start_time_gmt -> hevy_title
    hevy_by_time: dict[str, str] = {}
    for w in workouts:
        hw = w["hevy_workout"]
        start = hw.get("start_time", "")
        if start:
            # Hevy stores UTC as ISO 8601 (e.g. "2026-02-20T18:30:00+00:00")
            # Garmin startTimeGMT is "YYYY-MM-DD HH:MM:SS"
            dt = datetime.fromisoformat(start)
            gmt_str = dt.strftime("%Y-%m-%d %H:%M:%S")
            hevy_by_time[gmt_str] = w["hevy_title"]

    print(f"Built timestamp lookup with {len(hevy_by_time)} entries")

    # Fetch all Garmin strength activities (paginated)
    garmin_client = init_garmin()
    print("Fetching Garmin strength activities...")
    all_activities = []
    page = 0
    page_size = 100
    while True:
        batch = rate_limited_call(
            garmin_client.get_activities, page * page_size, page_size
        )
        if not batch:
            break
        strength = [
            a for a in batch
            if a.get("activityType", {}).get("typeKey") == "strength_training"
        ]
        all_activities.extend(strength)
        page += 1
        if len(batch) < page_size:
            break

    print(f"Found {len(all_activities)} Garmin strength activities")

    renamed = 0
    not_matched = 0
    already_correct = 0

    for act in all_activities:
        aid = act["activityId"]
        garmin_start = act.get("startTimeGMT", "")
        current_name = act.get("activityName", "")

        # Try exact match
        hevy_title = hevy_by_time.get(garmin_start)

        if not hevy_title:
            # Try +-60 second window for timestamp drift
            try:
                gmt_dt = datetime.strptime(garmin_start, "%Y-%m-%d %H:%M:%S")
                for offset_s in range(-60, 61):
                    candidate = (gmt_dt + timedelta(seconds=offset_s)).strftime(
                        "%Y-%m-%d %H:%M:%S"
                    )
                    if candidate in hevy_by_time:
                        hevy_title = hevy_by_time[candidate]
                        break
            except (ValueError, TypeError):
                pass

        if not hevy_title:
            not_matched += 1
            continue

        if current_name == hevy_title:
            already_correct += 1
            continue

        try:
            rate_limited_call(garmin_client.set_activity_name, aid, hevy_title)
            renamed += 1
            print(f"  [{renamed}] {aid}: '{current_name}' -> '{hevy_title}'")
        except Exception as e:
            print(f"  ERROR renaming {aid}: {e}")

    print(f"\nRename summary:")
    print(f"  Renamed: {renamed}")
    print(f"  Already correct: {already_correct}")
    print(f"  No Hevy match: {not_matched}")


# ---------------------------------------------------------------------------
# Incremental auto-enrichment (called by pipeline)
# ---------------------------------------------------------------------------

def enrich_new_workouts() -> int:
    """Incrementally enrich new or stale Hevy workouts.

    Called automatically at the end of each sync pipeline run.

    1. Finds Hevy workouts with no enrichment row (new)
    2. Finds workouts with fallback HR (avg_N/static) — retries in case
       Garmin daily HR data has arrived since last run
    3. Resolves HR from Garmin daily monitoring
    4. Computes calories via Keytel formula
    5. Saves enrichment data
    6. Matches to Garmin activities

    Returns count of newly enriched/updated workouts.
    """
    from fit_generator import _calc_calories, _parse_timestamp

    with get_connection() as conn:
        workouts = get_all_hevy_workouts(conn)

    if not workouts:
        print("  No Hevy workouts found")
        return 0

    # Find which ones already have enrichment
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT hevy_id, hr_source, garmin_activity_id FROM workout_enrichment")
            existing = {row[0]: {"hr_source": row[1], "garmin_activity_id": row[2]}
                        for row in cur.fetchall()}

    # New workouts (not in enrichment table)
    new_workouts = [w for w in workouts if w["hevy_id"] not in existing]
    # Stale workouts (used fallback HR, might now have real Garmin daily data)
    stale_workouts = [
        w for w in workouts
        if w["hevy_id"] in existing and existing[w["hevy_id"]]["hr_source"] != "daily"
    ]

    to_enrich = new_workouts + stale_workouts
    if not to_enrich:
        print("  All workouts already enriched with real HR data")
        return 0

    print(f"  {len(new_workouts)} new, {len(stale_workouts)} stale (retrying for real HR)")

    # Get recent real HR averages for fallback calculation
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT avg_hr FROM workout_enrichment
                   WHERE hr_source = 'daily' AND avg_hr >= %s
                   ORDER BY workout_date DESC LIMIT %s""",
                (_MIN_EXERCISE_HR, _FALLBACK_HR_WINDOW),
            )
            recent_hr_avgs: list[float] = [row[0] for row in cur.fetchall()]

    # Build Garmin startTimeGMT lookup for timezone-offset correction
    garmin_start_times: dict[int, str] = {}
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT activity_id, raw_json->>'startTimeGMT' AS start_gmt,
                       raw_json->>'duration' AS duration
                FROM garmin_activity_raw
                WHERE endpoint_name = 'summary'
                  AND raw_json->'activityType'->>'typeKey' = 'strength_training'
            """)
            for row in cur.fetchall():
                garmin_start_times[row[0]] = (row[1], float(row[2]) if row[2] else None)

    enriched = 0
    for w in to_enrich:
        try:
            with get_connection() as conn:
                hw = w["hevy_workout"]
                old_info = existing.get(w["hevy_id"])
                old_source = old_info["hr_source"] if old_info else None
                garmin_aid = old_info["garmin_activity_id"] if old_info else None

                # For stale workouts with a Garmin activity, try using the Garmin
                # startTimeGMT to correct the HR search window (fixes timezone offset)
                hr_samples = []
                hr_source = ""
                if old_source and garmin_aid and garmin_aid in garmin_start_times:
                    gmt_str, g_duration = garmin_start_times[garmin_aid]
                    if gmt_str:
                        # Build corrected UTC start/end from Garmin timestamps
                        hevy_start = hw.get("start_time", "")
                        hevy_end = hw.get("end_time", "")
                        if hevy_start and hevy_end:
                            hevy_dur = (_parse_timestamp(hevy_end) - _parse_timestamp(hevy_start)).total_seconds()
                        else:
                            hevy_dur = g_duration or 3600
                        garmin_start_utc = gmt_str.replace(" ", "T") + "+00:00"
                        garmin_end_dt = _parse_timestamp(garmin_start_utc) + timedelta(seconds=hevy_dur)
                        garmin_end_utc = garmin_end_dt.isoformat()

                        hr_samples = get_daily_hr_for_window(conn, garmin_start_utc, garmin_end_utc)
                        if hr_samples:
                            avg = sum(hr_samples) / len(hr_samples)
                            if avg >= _MIN_EXERCISE_HR:
                                hr_source = "daily"
                            else:
                                hr_samples = []  # resting HR, discard

                # Fall back to standard resolution (Hevy timestamps)
                if not hr_samples:
                    hr_samples, hr_source = resolve_hr_samples(conn, hw, recent_hr_avgs)

                # For stale workouts, only update if we now have better data
                if old_source and hr_source == old_source:
                    continue  # no improvement, skip

                # Need start/end times for calorie calculation
                start = hw.get("start_time", "")
                end = hw.get("end_time", "")
                if not start or not end:
                    continue

                start_dt = _parse_timestamp(start)
                end_dt = _parse_timestamp(end)
                duration_s = (end_dt - start_dt).total_seconds()
                calories = _calc_calories(hr_samples, duration_s, start_dt.year)

                # Count exercises and sets
                exercises = hw.get("exercises", [])
                exercise_count = len(exercises)
                total_sets = sum(len(ex.get("sets", [])) for ex in exercises)

                avg_hr = round(sum(hr_samples) / len(hr_samples)) if hr_samples else None

                upsert_workout_enrichment(
                    conn,
                    hevy_id=w["hevy_id"],
                    hr_source=hr_source,
                    avg_hr=avg_hr,
                    max_hr=max(hr_samples) if hr_samples else None,
                    min_hr=min(hr_samples) if hr_samples else None,
                    hr_samples=hr_samples,
                    hr_sample_count=len(hr_samples),
                    calories=calories,
                    duration_s=duration_s,
                    exercise_count=exercise_count,
                    total_sets=total_sets,
                    hevy_title=w.get("hevy_title"),
                    workout_date=w.get("date"),
                    status="enriched",
                )
                enriched += 1

                # Keep recent_hr_avgs up to date for fallback calculation
                if hr_source == "daily" and avg_hr and avg_hr >= _MIN_EXERCISE_HR:
                    recent_hr_avgs.insert(0, float(avg_hr))

                label = "NEW" if not old_source else f"UPDATED ({old_source} -> {hr_source})"
                print(
                    f"    {label}: {w['hevy_title']} ({w['date']}) "
                    f"- {hr_source}, avg_hr={avg_hr}, {calories} kcal"
                )
        except Exception as e:
            print(f"    ERROR enriching {w.get('hevy_id', '?')}: {e}")

    # Match to Garmin activities for any enriched workouts
    if enriched > 0:
        print("  Matching to Garmin activities...")
        _populate_garmin_ids()

    return enriched


# ---------------------------------------------------------------------------
# Enrich-only mode (full re-enrichment, CLI only)
# ---------------------------------------------------------------------------

def _enrich_all_workouts(args):
    """Re-compute HR and calories for all workouts and save to DB.

    Also populates garmin_activity_id by matching timestamps with Garmin activities.
    """
    with get_connection() as conn:
        workouts = get_all_hevy_workouts(conn)

    print(f"Found {len(workouts)} Hevy workouts to enrich")

    # Resolve HR for all workouts
    print("Resolving heart rate data...")
    with get_connection() as conn:
        recent_hr_avgs: list[float] = []
        workout_hr: list[tuple[list[int], str]] = []

        for w in workouts:
            hw = w["hevy_workout"]
            start = hw.get("start_time", "")
            end = hw.get("end_time", "")
            if start and end:
                hr = get_daily_hr_for_window(conn, start, end)
            else:
                hr = []

            if hr:
                avg = sum(hr) / len(hr)
                if avg >= _MIN_EXERCISE_HR:
                    recent_hr_avgs.append(avg)
                    workout_hr.append((hr, "daily"))
                else:
                    workout_hr.append(([], ""))
            else:
                workout_hr.append(([], ""))

        for i, (hr, source) in enumerate(workout_hr):
            if source == "":
                hr, source = resolve_hr_samples(
                    conn, workouts[i]["hevy_workout"], recent_hr_avgs
                )
                workout_hr[i] = (hr, source)

    with_hr = sum(1 for _, s in workout_hr if s == "daily")
    print(f"  {with_hr} with real HR, {len(workouts) - with_hr} using fallback\n")

    # Process each workout (enrich-only, no upload)
    os.makedirs(args.fit_dir, exist_ok=True)
    for i, workout in enumerate(workouts):
        hr_samples, hr_source = workout_hr[i]
        print(f"[{i+1}/{len(workouts)}] {workout['hevy_title']} ({workout['date']})")
        process_workout(
            workout,
            hr_samples=hr_samples,
            hr_source=hr_source,
            enrich_only=True,
            fit_dir=args.fit_dir,
        )

    # Now populate garmin_activity_ids by matching timestamps
    print("\nPopulating Garmin activity IDs...")
    _populate_garmin_ids()

    print("\nEnrichment complete!")


def _populate_garmin_ids():
    """Match enrichment rows to Garmin activities by timestamp and update garmin_activity_id.

    Uses a two-pass approach:
      1. Exact match (+-60s) on timestamp
      2. Fuzzy match within +-6h to handle Hevy local-time-as-UTC offset
    """
    with get_connection() as conn:
        workouts = get_all_hevy_workouts(conn)

    # Build hevy_id -> datetime lookup
    hevy_dts: dict[str, datetime] = {}
    for w in workouts:
        hw = w["hevy_workout"]
        start = hw.get("start_time", "")
        if start:
            hevy_dts[w["hevy_id"]] = datetime.fromisoformat(start).replace(tzinfo=None)

    # Build garmin (datetime, activity_id) list from DB
    garmin_activities: list[tuple[datetime, int]] = []
    garmin_by_time: dict[str, int] = {}
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT activity_id, raw_json->>'startTimeGMT' AS start_gmt
                FROM garmin_activity_raw
                WHERE endpoint_name = 'summary'
                  AND raw_json->'activityType'->>'typeKey' = 'strength_training'
            """)
            for row in cur.fetchall():
                gmt_str = row[1]
                garmin_by_time[gmt_str] = row[0]
                garmin_activities.append(
                    (datetime.strptime(gmt_str, "%Y-%m-%d %H:%M:%S"), row[0])
                )

    matched = 0
    fuzzy_window = timedelta(hours=6)
    with get_connection() as conn:
        for hevy_id, hdt in hevy_dts.items():
            htime_str = hdt.strftime("%Y-%m-%d %H:%M:%S")
            garmin_id = garmin_by_time.get(htime_str)

            # Pass 1: exact +-60s
            if not garmin_id:
                for offset_s in range(-60, 61):
                    candidate = (hdt + timedelta(seconds=offset_s)).strftime(
                        "%Y-%m-%d %H:%M:%S"
                    )
                    if candidate in garmin_by_time:
                        garmin_id = garmin_by_time[candidate]
                        break

            # Pass 2: closest within +-6h (handles Hevy local-time offset)
            if not garmin_id:
                candidates = [
                    (aid, gdt) for gdt, aid in garmin_activities
                    if abs(gdt - hdt) <= fuzzy_window
                ]
                if candidates:
                    garmin_id = min(candidates, key=lambda x: abs(x[1] - hdt))[0]

            if garmin_id:
                with conn.cursor() as cur:
                    cur.execute(
                        """UPDATE workout_enrichment
                           SET garmin_activity_id = %s, status = 'uploaded', updated_at = NOW()
                           WHERE hevy_id = %s""",
                        (garmin_id, hevy_id),
                    )
                matched += 1

    print(f"  Matched {matched}/{len(hevy_dts)} workouts to Garmin activities")


# ---------------------------------------------------------------------------
# Fix-outliers mode
# ---------------------------------------------------------------------------

def _fix_outlier_workouts(args):
    """Find workouts with resting-level daily HR, delete from Garmin, re-upload."""
    from garmin_client import init_garmin, rate_limited_call

    with get_connection() as conn:
        outliers = get_outlier_workouts(conn, max_avg_hr=_MIN_EXERCISE_HR)

    if not outliers:
        print("No calorie outlier workouts found!")
        return

    print(f"Found {len(outliers)} outlier workouts to fix:")
    for o in outliers:
        print(f"  {o['hevy_title']} ({o['workout_date']}) - avg_hr={o['avg_hr']}, "
              f"calories={o['calories']}, garmin_id={o['garmin_activity_id']}")

    garmin_client = init_garmin()

    # Re-fetch full workout data
    with get_connection() as conn:
        all_workouts = get_all_hevy_workouts(conn)
    workout_lookup = {w["hevy_id"]: w for w in all_workouts}

    # Resolve HR with the threshold applied (will get avg_N instead of bad daily)
    fixed = 0
    for o in outliers:
        hevy_id = o["hevy_id"]
        workout = workout_lookup.get(hevy_id)
        if not workout:
            print(f"  Workout {hevy_id} not found in DB, skipping")
            continue

        garmin_id = o["garmin_activity_id"]
        print(f"\nFixing: {o['hevy_title']} ({o['workout_date']})")

        # Delete from Garmin if we have the activity ID
        if garmin_id:
            try:
                print(f"  Deleting Garmin activity {garmin_id}...")
                rate_limited_call(garmin_client.delete_activity, str(garmin_id))
            except Exception as e:
                print(f"  Warning: could not delete activity {garmin_id}: {e}")

        # Re-resolve HR (threshold will reject the bad daily HR)
        with get_connection() as conn:
            # Get recent avgs from enrichment table (excluding this workout)
            with conn.cursor() as cur:
                cur.execute(
                    """SELECT avg_hr FROM workout_enrichment
                       WHERE hr_source = 'daily' AND avg_hr >= %s AND hevy_id != %s
                       ORDER BY workout_date DESC LIMIT %s""",
                    (_MIN_EXERCISE_HR, hevy_id, _FALLBACK_HR_WINDOW),
                )
                recent_avgs = [row[0] for row in cur.fetchall()]

            hr_samples, hr_source = resolve_hr_samples(
                conn, workout["hevy_workout"], recent_avgs
            )

        print(f"  New HR: {hr_source}, avg={sum(hr_samples)//len(hr_samples)} bpm")

        # Re-upload
        os.makedirs(args.fit_dir, exist_ok=True)
        result = process_workout(
            workout,
            hr_samples=hr_samples,
            hr_source=hr_source,
            garmin_client=garmin_client,
            fit_dir=args.fit_dir,
        )

        if result["status"] == "uploaded":
            fixed += 1
            # Clean up FIT file
            fit_path = result.get("fit_path")
            if fit_path and os.path.exists(fit_path):
                os.remove(fit_path)

    print(f"\nOutlier fix summary: {fixed}/{len(outliers)} fixed")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    """CLI entry point for converting Hevy workouts to Garmin FIT files."""
    parser = argparse.ArgumentParser(
        description="Convert Hevy workouts to FIT files and upload to Garmin Connect"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Generate FIT files but don't upload",
    )
    parser.add_argument(
        "--test-one",
        metavar="HEVY_ID",
        help="Process a single workout by Hevy ID",
    )
    parser.add_argument(
        "--batch",
        action="store_true",
        help="Process all Hevy workouts",
    )
    parser.add_argument(
        "--delete-old",
        action="store_true",
        help="Delete old DEVELOPMENT uploads from Garmin before uploading",
    )
    parser.add_argument(
        "--rename-only",
        action="store_true",
        help="Only rename existing Garmin activities to match Hevy titles (no upload)",
    )
    parser.add_argument(
        "--enrich-only",
        action="store_true",
        help="Re-compute HR/calories for all workouts and save to DB (no upload)",
    )
    parser.add_argument(
        "--fix-outliers",
        action="store_true",
        help="Fix calorie outlier workouts (delete from Garmin and re-upload)",
    )
    parser.add_argument(
        "--backup-dir",
        default=DEFAULT_BACKUP_DIR,
        help=f"Directory for manifest (default: {DEFAULT_BACKUP_DIR})",
    )
    parser.add_argument(
        "--fit-dir",
        default=DEFAULT_FIT_DIR,
        help=f"Directory for generated FIT files (default: {DEFAULT_FIT_DIR})",
    )
    args = parser.parse_args()

    modes = [args.test_one, args.batch, args.rename_only, args.enrich_only, args.fix_outliers]
    if not any(modes):
        parser.error("Must specify --test-one, --batch, --rename-only, --enrich-only, or --fix-outliers")

    # Handle special modes
    if args.rename_only:
        _rename_all_activities(args)
        return

    if args.enrich_only:
        _enrich_all_workouts(args)
        return

    if args.fix_outliers:
        _fix_outlier_workouts(args)
        return

    # Fetch workouts
    with get_connection() as conn:
        workouts = get_all_hevy_workouts(conn, hevy_id=args.test_one)

    if not workouts:
        print("No workouts found.")
        sys.exit(0)

    print(f"Found {len(workouts)} workout(s)")

    # Load manifest to skip already-processed
    manifest = load_manifest(args.backup_dir)
    to_process = []
    for w in workouts:
        key = f"hevy_{w['hevy_id']}"
        if key in manifest and manifest[key].get("status") in ("uploaded", "dry_run"):
            continue
        to_process.append(w)

    skipped = len(workouts) - len(to_process)
    if skipped:
        print(f"  Skipping {skipped} already-processed workout(s)")

    if not to_process:
        print("All workouts already processed. Nothing to do.")
        sys.exit(0)

    print(f"Processing {len(to_process)} workout(s)...\n")

    # Resolve HR for all workouts (two passes: first get real HR, then fill gaps)
    print("Resolving heart rate data...")
    with get_connection() as conn:
        # Pass 1: collect real HR averages (newest first, matching workout order)
        recent_hr_avgs: list[float] = []
        workout_hr: list[tuple[list[int], str]] = []

        for w in to_process:
            hw = w["hevy_workout"]
            start = hw.get("start_time", "")
            end = hw.get("end_time", "")
            if start and end:
                hr = get_daily_hr_for_window(conn, start, end)
            else:
                hr = []

            if hr:
                avg = sum(hr) / len(hr)
                if avg >= _MIN_EXERCISE_HR:
                    recent_hr_avgs.append(avg)
                    workout_hr.append((hr, "daily"))
                else:
                    workout_hr.append(([], ""))  # resting HR, skip
            else:
                workout_hr.append(([], ""))  # placeholder

        # Pass 2: fill gaps using fallback
        with_hr = sum(1 for _, s in workout_hr if s == "daily")
        for i, (hr, source) in enumerate(workout_hr):
            if source == "":
                hr, source = resolve_hr_samples(
                    conn, to_process[i]["hevy_workout"], recent_hr_avgs
                )
                workout_hr[i] = (hr, source)

    without_hr = len(to_process) - with_hr
    print(f"  {with_hr} with real HR, {without_hr} using fallback\n")

    # Init Garmin client if needed
    garmin_client = None
    if not args.dry_run:
        print("Initializing Garmin client...")
        from garmin_client import init_garmin
        garmin_client = init_garmin()

    # Delete old DEVELOPMENT uploads if requested
    if args.delete_old:
        print("\n--- Deleting old DEVELOPMENT uploads ---")
        with get_connection() as conn:
            delete_old_uploads(garmin_client, conn, dry_run=args.dry_run)
        print()

    # Process each workout
    results = []
    for i, workout in enumerate(to_process):
        hr_samples, hr_source = workout_hr[i]
        print(
            f"[{i+1}/{len(to_process)}] {workout['hevy_title']} "
            f"({workout['date']})"
        )
        result = process_workout(
            workout,
            hr_samples=hr_samples,
            hr_source=hr_source,
            garmin_client=garmin_client,
            dry_run=args.dry_run,
            fit_dir=args.fit_dir,
        )
        results.append(result)

        # Update manifest
        key = f"hevy_{workout['hevy_id']}"
        manifest[key] = {
            "hevy_id": workout["hevy_id"],
            "status": result["status"],
            "date": workout.get("date"),
            "hr_source": hr_source,
            "processed_at": datetime.now(timezone.utc).isoformat(),
        }
        save_manifest(manifest, args.backup_dir)
        print()

    # Summary
    statuses = {}
    hr_sources = {}
    for i, r in enumerate(results):
        s = r["status"]
        statuses[s] = statuses.get(s, 0) + 1
        src = workout_hr[i][1]
        hr_sources[src] = hr_sources.get(src, 0) + 1

    print("=" * 50)
    print("Summary:")
    for status, count in sorted(statuses.items()):
        print(f"  {status}: {count}")
    print(f"  Total: {len(results)}")
    print(f"  HR sources: {hr_sources}")


if __name__ == "__main__":
    main()
