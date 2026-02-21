"""Full sync pipeline: fetch from Garmin + Hevy -> store raw -> parse to structured."""

import sys
from datetime import date, timedelta

from garmin_client import init_garmin
from garmin_sync import sync_day, sync_activities_for_date, sync_activity_details
from hevy_sync import sync_all_workouts
from hevy_client import HevyClient
from parsers import process_day
from db import get_connection, log_sync
from config import HEVY_API_KEY


def run_pipeline(days: int = 7):
    """Run the complete sync + parse pipeline for the last N days."""
    print(f"=== Soma Sync Pipeline ===")
    print(f"Syncing last {days} days...\n")

    total_raw = 0
    total_parsed = 0
    total_activities = 0

    # --- Garmin daily + activities ---
    print("Authenticating with Garmin Connect...")
    client = init_garmin()
    print("Authenticated successfully.\n")

    today = date.today()

    with get_connection() as conn:
        log_sync(conn, "full_pipeline", "running")

    for i in range(days):
        sync_date = today - timedelta(days=i)
        date_str = sync_date.isoformat()
        print(f"[{i+1}/{days}] {date_str}")

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

    # --- Log completion ---
    total = total_raw + total_activities
    with get_connection() as conn:
        log_sync(conn, "full_pipeline", "success", total)

    print(f"\n=== Pipeline Complete ===")
    print(f"Garmin daily records: {total_raw}")
    print(f"Activity detail records: {total_activities}")
    print(f"Days parsed: {total_parsed}/{days}")


if __name__ == "__main__":
    days = int(sys.argv[1]) if len(sys.argv) > 1 else 7
    run_pipeline(days)
