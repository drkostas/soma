"""Full sync pipeline: fetch from Garmin + Hevy -> store raw -> parse to structured."""

import json
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
from db import get_connection, log_sync, get_platform_credentials, upsert_platform_credentials, get_sync_rules
from config import HEVY_API_KEY

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
        # Persist refreshed tokens
        with get_connection() as conn:
            upsert_platform_credentials(
                conn, "strava", "oauth2",
                {**tokens, "access_token": new_tokens["access_token"],
                 "refresh_token": new_tokens["refresh_token"]},
                expires_at=new_tokens.get("expires_at"),
            )
    except Exception as e:
        print(f"Strava: token refresh failed: {e}")
        return

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
                  AND we.hevy_id NOT IN (
                    SELECT source_id FROM activity_sync_log
                    WHERE source_platform = 'hevy' AND destination = 'strava' AND status = 'sent'
                  )
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

        results = execute_routes(
            rules=rules,
            source_platform="hevy",
            activity_type="strength",
            workout=workout,
            hr_samples=hr_samples,
            strava_client=strava_client,
        )

        for r in results:
            if r["status"] == "sent":
                print(f"  Routed {hevy_id} ({hevy_title}) -> {r['destination']} OK")
                routed += 1
            else:
                print(f"  Route {hevy_id} -> {r['destination']} FAILED: {r.get('error')}")

    return routed


def run_pipeline(days: int | None = None):
    """Run the complete sync + parse pipeline.

    If days is None (default), automatically determines which dates need
    re-syncing by checking for incomplete daily HR data. If an explicit
    number of days is passed, syncs that fixed range instead.
    """
    today = date.today()

    if days is not None:
        dates_to_sync = [today - timedelta(days=i) for i in range(days)]
        mode = f"fixed ({days} days)"
    else:
        dates_to_sync = _get_stale_dates()
        mode = f"smart ({len(dates_to_sync)} days, oldest: {dates_to_sync[-1].isoformat()})"

    print(f"=== Soma Sync Pipeline ===")
    print(f"Mode: {mode}")
    print(f"Dates: {', '.join(d.isoformat() for d in dates_to_sync)}\n")

    total_raw = 0
    total_parsed = 0
    total_activities = 0

    # --- Garmin daily + activities ---
    print("Authenticating with Garmin Connect...")
    client = init_garmin()
    print("Authenticated successfully.\n")

    with get_connection() as conn:
        log_sync(conn, "full_pipeline", "running")

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
        hevy = HevyClient(HEVY_API_KEY)
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

    # --- Log completion ---
    total = total_raw + total_activities
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
