"""Full sync pipeline: fetch from Garmin -> store raw -> parse to structured."""

import sys
from datetime import date, timedelta

from garmin_client import init_garmin
from garmin_sync import sync_day
from parsers import process_day
from db import get_connection, log_sync


def run_pipeline(days: int = 7):
    """Run the complete sync + parse pipeline for the last N days."""
    print(f"=== Soma Sync Pipeline ===")
    print(f"Syncing last {days} days...\n")

    # Step 1: Initialize Garmin client
    print("Authenticating with Garmin Connect...")
    client = init_garmin()
    print("Authenticated successfully.\n")

    today = date.today()
    total_raw = 0
    total_parsed = 0

    with get_connection() as conn:
        log_sync(conn, "full_pipeline", "running")

    # Step 2: Sync raw data from Garmin
    for i in range(days):
        sync_date = today - timedelta(days=i)
        date_str = sync_date.isoformat()
        print(f"[{i+1}/{days}] {date_str}")

        try:
            count = sync_day(client, sync_date)
            total_raw += count
            print(f"  Raw: {count} endpoints saved")
        except Exception as e:
            print(f"  Raw sync error: {e}")

        # Step 3: Parse raw -> structured
        try:
            process_day(sync_date)
            total_parsed += 1
            print(f"  Parsed: OK")
        except Exception as e:
            print(f"  Parse error: {e}")

    # Step 4: Log completion
    with get_connection() as conn:
        log_sync(conn, "full_pipeline", "success", total_raw)

    print(f"\n=== Pipeline Complete ===")
    print(f"Raw records: {total_raw}")
    print(f"Days parsed: {total_parsed}/{days}")


if __name__ == "__main__":
    days = int(sys.argv[1]) if len(sys.argv) > 1 else 7
    run_pipeline(days)
