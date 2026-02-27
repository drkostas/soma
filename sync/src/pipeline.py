"""Full sync pipeline: fetch from Garmin + Hevy -> store raw -> parse to structured."""

import json
import os
import sys
from datetime import date, timedelta

from garmin_client import init_garmin
from garmin_sync import sync_day, sync_activities_for_date, sync_activity_details
from hevy_sync import sync_all_workouts
from hevy_client import HevyClient
from parsers import process_day
from activity_replacer import enrich_new_workouts
from router import execute_routes
from strava_client import StravaClient
from strava_sync import sync_recent_activities, sync_activity_details as strava_sync_activity_details
from db import get_connection, log_sync, update_sync_log, get_platform_credentials, upsert_platform_credentials, get_sync_rules, log_activity_sync
from config import get_hevy_api_key

# A full day of Garmin daily HR data has ~700-720 points (midnight to midnight).
# Anything below this threshold is considered incomplete / needs re-sync.
_MIN_COMPLETE_HR_POINTS = 650


def _get_stale_dates(max_lookback: int = 14) -> list[date]:
    """Find dates that need re-syncing due to incomplete daily HR data.

    Walks backwards from yesterday looking for the most recent date with
    complete HR data (650+ points). Returns all dates from the first
    incomplete one through today.

    Today is always included (day isn't over yet).
    """
    today = date.today()
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT date,
                       CASE WHEN jsonb_typeof(raw_json->'heartRateValues') = 'array'
                            THEN jsonb_array_length(raw_json->'heartRateValues')
                            ELSE 0
                       END as pts
                FROM garmin_raw_data
                WHERE endpoint_name = 'heart_rates'
                  AND date >= CURRENT_DATE - %s
                  AND date < CURRENT_DATE
                ORDER BY date DESC
                """,
                (max_lookback,),
            )
            # Walk backwards from yesterday — find first complete day
            for row in cur.fetchall():
                if row[1] >= _MIN_COMPLETE_HR_POINTS:
                    # This day is complete. Sync from the next day to today.
                    days_back = (today - row[0]).days
                    return [today - timedelta(days=i) for i in range(days_back)]
            # No complete day found in the lookback window
            return [today - timedelta(days=i) for i in range(max_lookback)]


def _sync_strava():
    """Sync Strava activities if credentials are configured."""
    with get_connection() as conn:
        creds = get_platform_credentials(conn, "strava")
    if not creds or creds["status"] != "active":
        print("Strava: not connected, skipping.")
        return

    tokens = creds["credentials"]
    client = StravaClient(
        access_token=tokens["access_token"],
        refresh_token=tokens["refresh_token"],
    )

    # Refresh token if needed (also updates client in-place)
    try:
        new_tokens = client.refresh_tokens()
        # Convert epoch int to datetime for timestamptz column
        from datetime import datetime as _dt, timezone as _tz
        expires_epoch = new_tokens.get("expires_at")
        expires_dt = (
            _dt.fromtimestamp(expires_epoch, tz=_tz.utc)
            if expires_epoch else None
        )
        # Persist refreshed tokens
        with get_connection() as conn:
            upsert_platform_credentials(
                conn, "strava", "oauth2",
                {**tokens, "access_token": new_tokens["access_token"],
                 "refresh_token": new_tokens["refresh_token"]},
                expires_at=expires_dt,
            )
    except Exception as e:
        print(f"  Strava: token refresh failed: {e}")
        print("  Strava sync skipped (non-fatal).")
        return None

    # Pull recent activities
    print("Syncing Strava activities...")
    count = sync_recent_activities(client)
    print(f"  Strava: {count} activities synced.")

    # Fetch details for activities that don't have them yet
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT strava_id FROM strava_raw_data
                WHERE endpoint_name = 'activity'
                  AND strava_id NOT IN (
                    SELECT strava_id FROM strava_raw_data WHERE endpoint_name = 'detail'
                  )
                ORDER BY synced_at DESC
                LIMIT 20
            """)
            new_ids = [row[0] for row in cur.fetchall()]
    if new_ids:
        print(f"  Fetching details for {len(new_ids)} new activities...")
        for aid in new_ids:
            strava_sync_activity_details(client, aid)


def _route_enriched_workouts(strava_client=None) -> int:
    """Route recently enriched Hevy workouts to configured destinations.

    Looks up enabled sync rules for hevy, queries for enriched workouts
    from the last 24 hours that haven't been synced to strava yet, and
    dispatches each through execute_routes.

    Returns the count of successfully routed activities.
    """
    with get_connection() as conn:
        rules = get_sync_rules(conn, source_platform="hevy", enabled_only=True)

    if not rules:
        print("  No hevy routing rules configured, skipping.")
        return 0

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT we.hevy_id, we.hevy_title, h.raw_json, we.hr_samples
                FROM workout_enrichment we
                JOIN hevy_raw_data h ON h.hevy_id = we.hevy_id AND h.endpoint_name = 'workout'
                WHERE we.status IN ('enriched', 'uploaded')
                  AND we.updated_at >= NOW() - INTERVAL '24 hours'
                  AND we.workout_date >= CURRENT_DATE - INTERVAL '7 days'
                ORDER BY we.workout_date DESC
            """)
            rows = cur.fetchall()

    if not rows:
        print("  No enriched workouts to route.")
        return 0

    routed = 0
    for hevy_id, hevy_title, raw_json, hr_samples in rows:
        raw = json.loads(raw_json) if isinstance(raw_json, str) else raw_json
        workout = {
            "hevy_id": hevy_id,
            "hevy_title": hevy_title,
            "hevy_workout": raw,
        }

        with get_connection() as conn:
            results = execute_routes(
                rules=rules,
                source_platform="hevy",
                activity_type="strength",
                workout=workout,
                hr_samples=hr_samples,
                strava_client=strava_client,
                conn=conn,
            )

        for r in results:
            if r["status"] == "sent":
                print(f"  Routed {hevy_id} ({hevy_title}) -> {r['destination']} OK")
                routed += 1
            else:
                print(f"  Route {hevy_id} -> {r['destination']} FAILED: {r.get('error')}")

    return routed


def _enrich_garmin_activity(garmin_client, garmin_activity_id: int, hevy_id: str,
                            raw_json: dict, enrichment: dict, hr_samples, hr_source: str):
    """Add description and image to a Garmin activity after upload."""
    from garmin_client import set_activity_description, upload_activity_image
    from strava_description import generate_description
    import urllib.request

    # Generate and set description
    try:
        samples = hr_samples if hr_source == "daily" else None
        desc = generate_description(hevy_id, raw_json, enrichment, samples)
        set_activity_description(garmin_client, garmin_activity_id, desc)
        print(f"    Description set ({len(desc)} chars)")
    except Exception as e:
        print(f"    Description failed: {e}")

    # Upload image (HR chart portion is already omitted in the image when HR is static)
    try:
        url = f"{os.environ.get('SOMA_WEB_URL', 'http://localhost:3456')}/api/workout/{hevy_id}/image"
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=30) as resp:
            if resp.status == 200:
                image_bytes = resp.read()
                upload_activity_image(garmin_client, garmin_activity_id, image_bytes)
                print(f"    Image uploaded ({len(image_bytes) // 1024}KB)")
                # Notify Telegram with the same image
                try:
                    from telegram_notify import send_image, is_configured
                    if is_configured():
                        title = raw_json.get("title", "Workout")
                        workout_date = str(raw_json.get("start_time", ""))[:10]
                        send_image(image_bytes, caption=f"\U0001f4aa {title} — {workout_date}", filename=f"{hevy_id}.png")
                        print(f"    Telegram: notified")
                except Exception as _te:
                    print(f"    Telegram: {_te}")
            else:
                print(f"    Image skipped (HTTP {resp.status})")
    except Exception as e:
        print(f"    Image skipped ({e})")


def _backfill_garmin_enrichment(garmin_client) -> int:
    """Set name/description/image on Garmin activities that were uploaded but
    didn't get enriched (e.g. because activity ID wasn't available at upload time).

    Only runs when a hevy → garmin sync rule exists. Checks for 'uploaded'
    workouts that have a garmin_activity_id but were never enriched (tracked
    via garmin_enriched flag).
    """
    from garmin_client import rate_limited_call

    # Check for hevy → garmin sync rules
    with get_connection() as conn:
        rules = get_sync_rules(conn, source_platform="hevy", enabled_only=True)
    garmin_rules = [
        r for r in rules
        if "garmin" in (r.get("destinations") or {})
    ]
    if not garmin_rules:
        print("  No hevy → garmin rules configured, skipping backfill.")
        return 0

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT we.hevy_id, we.hevy_title, we.garmin_activity_id,
                       h.raw_json, we.hr_samples, we.hr_source,
                       we.avg_hr, we.max_hr, we.calories, we.duration_s
                FROM workout_enrichment we
                JOIN hevy_raw_data h ON h.hevy_id = we.hevy_id AND h.endpoint_name = 'workout'
                WHERE we.status = 'uploaded'
                  AND we.garmin_activity_id IS NOT NULL
                  AND COALESCE(we.garmin_enriched, false) = false
                ORDER BY we.workout_date DESC
                LIMIT 10
            """)
            rows = cur.fetchall()

    if not rows:
        return 0

    count = 0
    for hevy_id, hevy_title, garmin_id, raw_json, hr_samples, hr_source, avg_hr, max_hr, calories, duration_s in rows:
        raw = json.loads(raw_json) if isinstance(raw_json, str) else raw_json
        print(f"  Backfilling Garmin enrichment for {hevy_title} (garmin:{garmin_id})...")

        try:
            # Rename
            rate_limited_call(garmin_client.set_activity_name, garmin_id, hevy_title)
            print(f"    Renamed to '{hevy_title}'")
        except Exception as e:
            print(f"    Rename failed: {e}")

        # Description + image
        enrichment = {"avg_hr": avg_hr, "max_hr": max_hr, "calories": calories, "duration_s": duration_s}
        _enrich_garmin_activity(
            garmin_client, int(garmin_id), hevy_id,
            raw, enrichment, hr_samples, hr_source or "unknown",
        )

        # Mark as enriched
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE workout_enrichment SET garmin_enriched = true WHERE hevy_id = %s",
                    (hevy_id,),
                )
        count += 1

    print(f"  Backfilled {count} Garmin activities")
    return count


def _upload_enriched_to_garmin(garmin_client) -> int:
    """Upload enriched Hevy workouts to Garmin Connect.

    Only runs when a hevy → garmin sync rule exists. First matches any
    already-uploaded workouts to Garmin activities (409 prevention).
    Then uploads remaining 'enriched' workouts: generates FIT, uploads,
    renames, and adds description + image.

    Returns count of successfully uploaded workouts.
    """
    import os
    from activity_replacer import process_workout, _populate_garmin_ids, DEFAULT_FIT_DIR

    # Check for hevy → garmin sync rules
    with get_connection() as conn:
        rules = get_sync_rules(conn, source_platform="hevy", enabled_only=True)
    garmin_rules = [
        r for r in rules
        if "garmin" in (r.get("destinations") or {})
    ]
    if not garmin_rules:
        print("  No hevy → garmin rules configured, skipping upload.")
        return 0

    # Match already-uploaded workouts first (prevents 409 on re-upload)
    _populate_garmin_ids()

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT we.hevy_id, we.hevy_title, h.raw_json,
                       we.hr_samples, we.hr_source, we.workout_date,
                       we.avg_hr, we.max_hr, we.calories, we.duration_s
                FROM workout_enrichment we
                JOIN hevy_raw_data h ON h.hevy_id = we.hevy_id AND h.endpoint_name = 'workout'
                WHERE we.status = 'enriched'
                  AND we.hevy_id NOT IN (
                    SELECT source_id FROM activity_sync_log
                    WHERE source_platform = 'hevy' AND destination = 'garmin'
                      AND status IN ('sent', 'external')
                  )
                ORDER BY we.workout_date DESC
            """)
            rows = cur.fetchall()

    if not rows:
        print("  No enriched workouts to upload to Garmin.")
        return 0

    os.makedirs(DEFAULT_FIT_DIR, exist_ok=True)

    uploaded = 0
    for hevy_id, hevy_title, raw_json, hr_samples, hr_source, workout_date, avg_hr, max_hr, calories, duration_s in rows:
        raw = json.loads(raw_json) if isinstance(raw_json, str) else raw_json
        workout = {
            "hevy_id": hevy_id,
            "hevy_title": hevy_title,
            "hevy_workout": raw,
            "date": str(workout_date) if workout_date else "unknown",
        }

        print(f"  Uploading {hevy_id} ({hevy_title})...")
        result = process_workout(
            workout,
            hr_samples=hr_samples or [],
            hr_source=hr_source or "unknown",
            garmin_client=garmin_client,
            fit_dir=DEFAULT_FIT_DIR,
        )

        if result["status"] == "uploaded":
            uploaded += 1
            fit_path = result.get("fit_path")
            if fit_path and os.path.exists(fit_path):
                os.remove(fit_path)

            # Add name, description + image to the new Garmin activity
            garmin_id = result.get("new_activity_id")
            if garmin_id:
                enrichment = {
                    "avg_hr": avg_hr,
                    "max_hr": max_hr,
                    "calories": calories,
                    "duration_s": duration_s,
                }
                _enrich_garmin_activity(
                    garmin_client, int(garmin_id), hevy_id,
                    raw, enrichment, hr_samples, hr_source or "unknown",
                )
                with get_connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            "UPDATE workout_enrichment SET garmin_enriched = true WHERE hevy_id = %s",
                            (hevy_id,),
                        )
                    log_activity_sync(
                        conn,
                        source_platform="hevy",
                        source_id=hevy_id,
                        destination="garmin",
                        destination_id=str(garmin_id),
                        rule_id=garmin_rules[0]["id"],
                        status="sent",
                    )
        else:
            error_msg = result.get("error", "")
            if "409" in str(error_msg):
                # Already on Garmin — match it via _populate_garmin_ids
                print(f"    Already on Garmin (409), will match via populate_garmin_ids")
            else:
                print(f"    Failed: {error_msg or result['status']}")

    # Final pass to match any 409 uploads or async-processed uploads
    _populate_garmin_ids()

    # Backfill name/description/image for workouts that got matched after upload
    _backfill_garmin_enrichment(garmin_client)

    return uploaded


def _enrich_garmin_run_activities(garmin_client) -> int:
    """Set description and upload share image to recent Garmin run activities.

    Runs after _route_garmin_activities(). Finds running activities from the
    last 48 hours that haven't been enriched yet (tracked in activity_sync_log
    with destination='garmin_image'), sets a generated description, and
    uploads the share card image.

    Returns count of enriched activities.
    """
    import urllib.request
    from garmin_client import set_activity_description, upload_activity_image
    from garmin_push import generate_run_strava_description, _get_activity_hr_zones
    import json as _json

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT activity_id, raw_json
                FROM garmin_activity_raw
                WHERE endpoint_name = 'summary'
                  AND synced_at >= NOW() - INTERVAL '48 hours'
                  AND COALESCE(raw_json->>'manufacturer', '') != 'DEVELOPMENT'
                  AND (raw_json->'activityType'->>'typeKey') IN ('running', 'trail_running', 'treadmill_running')
                  AND activity_id::text NOT IN (
                    SELECT source_id FROM activity_sync_log
                    WHERE source_platform = 'garmin' AND destination = 'garmin_image'
                      AND status = 'sent'
                  )
                ORDER BY raw_json->>'startTimeGMT' DESC
            """)
            rows = cur.fetchall()

    if not rows:
        print("  No Garmin run activities need enrichment.")
        return 0

    enriched = 0
    for activity_id, raw_json in rows:
        summary = _json.loads(raw_json) if isinstance(raw_json, str) else raw_json
        name = summary.get("activityName", "Run")
        print(f"  Enriching Garmin run {activity_id} ({name})...")

        # Set description
        try:
            with get_connection() as conn:
                hr_zones = _get_activity_hr_zones(conn, activity_id)
            desc = generate_run_strava_description(summary, hr_zones)
            if desc:
                set_activity_description(garmin_client, int(activity_id), desc)
                print(f"    Description set ({len(desc)} chars)")
        except Exception as e:
            print(f"    Description failed: {e}")

        # Upload share image
        try:
            url = f"{os.environ.get('SOMA_WEB_URL', 'http://localhost:3456')}/api/activity/{activity_id}/image"
            req = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(req, timeout=30) as resp:
                if resp.status == 200:
                    image_bytes = resp.read()
                    upload_activity_image(garmin_client, int(activity_id), image_bytes, filename=f"run_{activity_id}.png")
                    print(f"    Image uploaded ({len(image_bytes) // 1024} KB)")
                    # Notify Telegram with the same image
                    try:
                        from telegram_notify import send_image, is_configured
                        if is_configured():
                            run_date = summary.get("startTimeGMT", "")[:10]
                            send_image(image_bytes, caption=f"\U0001f3c3 {name} — {run_date}", filename=f"run_{activity_id}.png")
                            print(f"    Telegram: notified")
                    except Exception as _te:
                        print(f"    Telegram: {_te}")
                else:
                    print(f"    Image skipped (HTTP {resp.status})")
        except Exception as e:
            print(f"    Image skipped: {e}")

        # Log to prevent re-processing
        try:
            with get_connection() as conn:
                log_activity_sync(
                    conn,
                    source_platform="garmin",
                    source_id=str(activity_id),
                    destination="garmin_image",
                    destination_id=str(activity_id),
                    rule_id=None,
                    status="sent",
                )
        except Exception as e:
            print(f"    Log failed: {e}")

        enriched += 1

    print(f"  Enriched {enriched} Garmin run activities")
    return enriched


def _route_garmin_activities(strava_client=None, garmin_client=None) -> int:
    """Route recent Garmin activities to configured destinations.

    Looks up enabled sync rules for garmin, queries for recent activities
    that haven't been synced to strava yet, and dispatches each through
    execute_routes.

    Skips activities with manufacturer='DEVELOPMENT' (uploaded from Hevy).

    Returns the count of successfully routed activities.
    """
    with get_connection() as conn:
        rules = get_sync_rules(conn, source_platform="garmin", enabled_only=True)

    if not rules:
        print("  No garmin routing rules configured, skipping.")
        return 0

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT activity_id, raw_json
                FROM garmin_activity_raw
                WHERE endpoint_name = 'summary'
                  AND synced_at >= NOW() - INTERVAL '24 hours'
                  AND COALESCE(raw_json->>'manufacturer', '') != 'DEVELOPMENT'
                  AND activity_id::text NOT IN (
                    SELECT source_id FROM activity_sync_log
                    WHERE source_platform = 'garmin' AND destination = 'strava'
                      AND status IN ('sent', 'external')
                  )
                ORDER BY raw_json->>'startTimeGMT' DESC
            """)
            rows = cur.fetchall()

    if not rows:
        print("  No Garmin activities to route.")
        return 0

    routed = 0
    for activity_id, raw_json in rows:
        raw = json.loads(raw_json) if isinstance(raw_json, str) else raw_json
        activity_type = raw.get("activityType", {}).get("typeKey", "other")
        activity_name = raw.get("activityName", "Garmin Activity")

        workout = {
            "activity_id": str(activity_id),
            "source_id": str(activity_id),
        }

        results = execute_routes(
            rules=rules,
            source_platform="garmin",
            activity_type=activity_type,
            workout=workout,
            hr_samples=None,
            strava_client=strava_client,
            garmin_client=garmin_client,
        )

        for r in results:
            if r["status"] == "sent":
                print(f"  Routed garmin:{activity_id} ({activity_name}) -> {r['destination']} OK")
                routed += 1
            else:
                print(f"  Route garmin:{activity_id} -> {r['destination']} FAILED: {r.get('error')}")

    return routed


def run_pipeline(days: int | None = None):
    """Run the complete sync + parse pipeline.

    If days is None (default), automatically determines which dates need
    re-syncing by checking for incomplete daily HR data. If an explicit
    number of days is passed, syncs that fixed range instead.

    Scheduled runs (TRIGGERED_BY=schedule) are skipped if a sync completed
    successfully within the last hour — avoids redundant work after a
    manual "Sync Now".
    """
    today = date.today()

    triggered_by = os.environ.get("TRIGGERED_BY", "manual")
    if triggered_by == "schedule":
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT COUNT(*) FROM sync_log
                    WHERE status = 'success'
                      AND started_at >= NOW() - INTERVAL '1 hour'
                """)
                recent_count = cur.fetchone()[0]
        if recent_count > 0:
            print(f"Skipping scheduled sync — a sync completed successfully within the last hour.")
            return

    if days is not None:
        dates_to_sync = [today - timedelta(days=i) for i in range(days)]
        mode = f"fixed ({days} days)"
    else:
        dates_to_sync = _get_stale_dates()
        mode = f"smart ({len(dates_to_sync)} days, oldest: {dates_to_sync[-1].isoformat()})"

    print(f"=== Soma Sync Pipeline ===")
    print(f"Mode: {mode}")
    print(f"Dates: {', '.join(d.isoformat() for d in dates_to_sync)}\n")

    with get_connection() as conn:
        log_id = log_sync(conn, "full_pipeline", "running")

    try:
        _run_pipeline_inner(dates_to_sync, log_id=log_id)
    except Exception as e:
        print(f"\n!!! Pipeline crashed: {e}")
        with get_connection() as conn:
            update_sync_log(conn, log_id, "error", error=str(e))
        raise


def _run_pipeline_inner(dates_to_sync: list, log_id: int = None):
    """Inner pipeline logic, wrapped by run_pipeline for error handling."""
    total_raw = 0
    total_parsed = 0
    total_activities = 0

    # --- Garmin daily + activities ---
    print("Authenticating with Garmin Connect...")
    client = init_garmin()
    print("Authenticated successfully.\n")

    for idx, sync_date in enumerate(dates_to_sync):
        date_str = sync_date.isoformat()
        print(f"[{idx+1}/{len(dates_to_sync)}] {date_str}")

        # Daily health endpoints
        try:
            count = sync_day(client, sync_date)
            total_raw += count
            print(f"  Raw: {count} endpoints saved")
        except Exception as e:
            print(f"  Raw sync error: {e}")

        # Discover + fetch activity details for this day
        try:
            activity_ids = sync_activities_for_date(client, sync_date)
            for aid in activity_ids:
                detail_count = sync_activity_details(client, aid)
                total_activities += detail_count
                print(f"  Activity {aid}: {detail_count} detail endpoints")
        except Exception as e:
            print(f"  Activity sync error: {e}")

        # Parse raw -> structured
        try:
            process_day(sync_date)
            total_parsed += 1
            print(f"  Parsed: OK")
        except Exception as e:
            print(f"  Parse error: {e}")

    # --- Hevy workouts (page 1 only = latest 10) ---
    print(f"\nSyncing recent Hevy workouts...")
    try:
        hevy = HevyClient(get_hevy_api_key())
        hevy_count = sync_all_workouts(hevy, start_page=1, page_size=10)
        print(f"  Hevy: {hevy_count} workouts saved")
    except Exception as e:
        print(f"  Hevy sync error: {e}")

    # --- Strava ---
    try:
        _sync_strava()
    except Exception as e:
        print(f"Strava sync error (non-fatal): {e}")

    # --- Auto-enrich new/stale workouts ---
    print(f"\nEnriching workouts with HR & calorie data...")
    try:
        enriched = enrich_new_workouts()
        print(f"  Enriched: {enriched} workouts")
    except Exception as e:
        print(f"  Enrichment error: {e}")

    # --- Upload enriched workouts to Garmin ---
    print(f"\nUploading enriched workouts to Garmin...")
    try:
        upload_count = _upload_enriched_to_garmin(garmin_client=client)
        print(f"  Uploaded: {upload_count} workouts to Garmin")
    except Exception as e:
        print(f"  Garmin upload error (non-fatal): {e}")

    # --- Route enriched workouts to destinations ---
    print(f"\nRouting enriched workouts...")
    try:
        strava_client_for_routing = None
        with get_connection() as conn:
            strava_creds = get_platform_credentials(conn, "strava")
        if strava_creds and strava_creds["status"] == "active":
            tokens = strava_creds["credentials"]
            strava_client_for_routing = StravaClient(
                access_token=tokens["access_token"],
                refresh_token=tokens["refresh_token"],
            )
        route_count = _route_enriched_workouts(strava_client=strava_client_for_routing)
        print(f"  Routed: {route_count} activities")
    except Exception as e:
        print(f"  Routing error (non-fatal): {e}")

    # --- Route Garmin activities to destinations ---
    print(f"\nRouting Garmin activities...")
    try:
        garmin_route_count = _route_garmin_activities(
            strava_client=strava_client_for_routing, garmin_client=client,
        )
        print(f"  Routed: {garmin_route_count} Garmin activities")
    except Exception as e:
        print(f"  Garmin routing error (non-fatal): {e}")

    # --- Enrich Garmin run activities (description + image upload) ---
    print(f"\nEnriching Garmin run activities...")
    try:
        run_enriched = _enrich_garmin_run_activities(garmin_client=client)
        print(f"  Enriched: {run_enriched} Garmin run activities")
    except Exception as e:
        print(f"  Garmin run enrichment error (non-fatal): {e}")

    # --- Reconcile Strava syncs ---
    print(f"\nReconciling Strava syncs...")
    try:
        from reconciler import reconcile_strava_syncs
        reconciled = reconcile_strava_syncs()
        print(f"  Reconciled: {reconciled} activities")
    except Exception as e:
        print(f"  Reconciliation error (non-fatal): {e}")

    # --- Log completion ---
    total = total_raw + total_activities
    if log_id:
        with get_connection() as conn:
            update_sync_log(conn, log_id, "success", total)
    else:
        with get_connection() as conn:
            log_sync(conn, "full_pipeline", "success", total)

    n = len(dates_to_sync)
    print(f"\n=== Pipeline Complete ===")
    print(f"Garmin daily records: {total_raw}")
    print(f"Activity detail records: {total_activities}")
    print(f"Days parsed: {total_parsed}/{n}")


if __name__ == "__main__":
    days = int(sys.argv[1]) if len(sys.argv) > 1 else None
    run_pipeline(days)
