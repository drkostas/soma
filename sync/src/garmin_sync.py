"""Sync daily health data from Garmin Connect to the database."""

from datetime import date, timedelta

from garmin_client import init_garmin, rate_limited_call
from db import get_connection, upsert_raw_data, log_sync


# Endpoints to sync for each day
DAILY_ENDPOINTS = {
    "user_summary": lambda client, d: client.get_stats(d),
    "heart_rates": lambda client, d: client.get_heart_rates(d),
    "sleep_data": lambda client, d: client.get_sleep_data(d),
    "stress_data": lambda client, d: client.get_all_day_stress(d),
    "hrv_data": lambda client, d: client.get_hrv_data(d),
    "spo2_data": lambda client, d: client.get_spo2_data(d),
}

# Endpoints that take date ranges
RANGE_ENDPOINTS = {
    "body_battery": lambda client, s, e: client.get_body_battery(s, e),
    "weigh_ins": lambda client, s, e: client.get_weigh_ins(s, e),
    "body_composition": lambda client, s, e: client.get_body_composition(s, e),
}


def sync_day(client, sync_date: date) -> int:
    """Sync all daily endpoints for a single date. Returns count of records saved."""
    date_str = sync_date.isoformat()
    count = 0

    with get_connection() as conn:
        for endpoint_name, fetch_fn in DAILY_ENDPOINTS.items():
            try:
                data = rate_limited_call(fetch_fn, client, date_str)
                if data:
                    upsert_raw_data(conn, sync_date, endpoint_name, data)
                    count += 1
            except Exception as e:
                print(f"  Warning: {endpoint_name} failed for {date_str}: {e}")

        # Range endpoints use single-day range
        for endpoint_name, fetch_fn in RANGE_ENDPOINTS.items():
            try:
                data = rate_limited_call(fetch_fn, client, date_str, date_str)
                if data:
                    upsert_raw_data(conn, sync_date, endpoint_name, data)
                    count += 1
            except Exception as e:
                print(f"  Warning: {endpoint_name} failed for {date_str}: {e}")

    return count


def sync_recent(days: int = 7):
    """Sync the last N days of data."""
    client = init_garmin()
    today = date.today()
    total_records = 0

    with get_connection() as conn:
        log_sync(conn, "garmin_daily", "running")

    for i in range(days):
        sync_date = today - timedelta(days=i)
        print(f"Syncing {sync_date.isoformat()}...")
        try:
            count = sync_day(client, sync_date)
            total_records += count
            print(f"  Saved {count} endpoints")
        except Exception as e:
            print(f"  Error syncing {sync_date}: {e}")

    with get_connection() as conn:
        log_sync(conn, "garmin_daily", "success", total_records)

    print(f"\nSync complete. {total_records} records saved across {days} days.")


if __name__ == "__main__":
    import sys
    days = int(sys.argv[1]) if len(sys.argv) > 1 else 7
    sync_recent(days)
