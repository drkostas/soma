"""Sync daily health data from Garmin Connect to the database."""

from datetime import date, timedelta

from garmin_client import init_garmin, rate_limited_call
from db import get_connection, upsert_raw_data, log_sync


# Endpoints to sync for each day (single date parameter)
DAILY_ENDPOINTS = {
    # Existing
    "user_summary": lambda client, d: client.get_stats(d),
    "heart_rates": lambda client, d: client.get_heart_rates(d),
    "sleep_data": lambda client, d: client.get_sleep_data(d),
    "stress_data": lambda client, d: client.get_all_day_stress(d),
    "hrv_data": lambda client, d: client.get_hrv_data(d),
    "spo2_data": lambda client, d: client.get_spo2_data(d),
    # New daily endpoints
    "respiration_data": lambda client, d: client.get_respiration_data(d),
    "steps_data": lambda client, d: client.get_steps_data(d),
    "floors": lambda client, d: client.get_floors(d),
    "hydration_data": lambda client, d: client.get_hydration_data(d),
    "blood_pressure": lambda client, d: client.get_blood_pressure(d),
    "training_readiness": lambda client, d: client.get_training_readiness(d),
    "training_status": lambda client, d: client.get_training_status(d),
    "max_metrics": lambda client, d: client.get_max_metrics(d),
    "race_predictions": lambda client, d: client.get_race_predictions(d),
    "endurance_score": lambda client, d: client.get_endurance_score(d),
    "hill_score": lambda client, d: client.get_hill_score(d),
    "fitnessage_data": lambda client, d: client.get_fitnessage_data(d),
    "intensity_minutes_data": lambda client, d: client.get_intensity_minutes_data(d),
    "daily_weigh_ins": lambda client, d: client.get_daily_weigh_ins(d),
    "rhr_day": lambda client, d: client.get_rhr_day(d),
}

# Endpoints that take date ranges (unchanged)
RANGE_ENDPOINTS = {
    "body_battery": lambda client, s, e: client.get_body_battery(s, e),
    "weigh_ins": lambda client, s, e: client.get_weigh_ins(s, e),
    "body_composition": lambda client, s, e: client.get_body_composition(s, e),
}

# Activity detail endpoints (per activity_id)
ACTIVITY_DETAIL_ENDPOINTS = {
    "details": lambda client, aid: client.get_activity_details(aid),
    "exercise_sets": lambda client, aid: client.get_activity_exercise_sets(aid),
    "splits": lambda client, aid: client.get_activity_splits(aid),
    "hr_zones": lambda client, aid: client.get_activity_hr_in_timezones(aid),
    "weather": lambda client, aid: client.get_activity_weather(aid),
    "gear": lambda client, aid: client.get_activity_gear(aid),
}

# One-time profile endpoints (no date parameter)
PROFILE_ENDPOINTS = {
    "user_profile": lambda client: client.get_user_profile(),
    "devices": lambda client: client.get_devices(),
    "activity_types": lambda client: client.get_activity_types(),
    "earned_badges": lambda client: client.get_earned_badges(),
    "personal_record": lambda client: client.get_personal_record(),
}

# These need userProfileNumber from user_profile response
PROFILE_ENDPOINTS_WITH_ID = {
    "gear": lambda client, uid: client.get_gear(uid),
    "gear_defaults": lambda client, uid: client.get_gear_defaults(uid),
}

# These may need special handling
PROFILE_ENDPOINTS_EXTRA = {
    "goals": lambda client: client.get_goals(""),
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


def sync_activities_for_date(client, sync_date: date) -> list[int]:
    """Discover activities for a date, return list of activity IDs."""
    date_str = sync_date.isoformat()
    try:
        activities = rate_limited_call(client.get_activities_by_date, date_str, date_str)
        if not activities:
            return []
        with get_connection() as conn:
            upsert_raw_data(conn, sync_date, "activities_list", activities)
        return [a["activityId"] for a in activities if "activityId" in a]
    except Exception as e:
        print(f"  Warning: activities_list failed for {date_str}: {e}")
        return []


def sync_activity_details(client, activity_id: int) -> int:
    """Fetch all detail endpoints for a single activity. Returns count saved."""
    from db import upsert_activity_raw
    count = 0
    with get_connection() as conn:
        for endpoint_name, fetch_fn in ACTIVITY_DETAIL_ENDPOINTS.items():
            try:
                data = rate_limited_call(fetch_fn, client, activity_id)
                if data:
                    upsert_activity_raw(conn, activity_id, endpoint_name, data)
                    count += 1
            except Exception as e:
                print(f"    Warning: activity {activity_id}/{endpoint_name} failed: {e}")
    return count


def sync_profile(client) -> int:
    """Fetch all one-time profile endpoints. Returns count saved."""
    from db import upsert_profile_raw
    count = 0
    with get_connection() as conn:
        # Fetch basic profile endpoints (no args needed)
        for endpoint_name, fetch_fn in PROFILE_ENDPOINTS.items():
            try:
                data = rate_limited_call(fetch_fn, client)
                if data:
                    upsert_profile_raw(conn, endpoint_name, data)
                    count += 1
                    print(f"  Profile: {endpoint_name} saved")
            except Exception as e:
                print(f"  Warning: profile/{endpoint_name} failed: {e}")

        # Fetch endpoints that need display_name (userProfileNumber)
        display_name = getattr(client, "display_name", None)
        if display_name:
            for endpoint_name, fetch_fn in PROFILE_ENDPOINTS_WITH_ID.items():
                try:
                    data = rate_limited_call(fetch_fn, client, display_name)
                    if data:
                        upsert_profile_raw(conn, endpoint_name, data)
                        count += 1
                        print(f"  Profile: {endpoint_name} saved")
                except Exception as e:
                    print(f"  Warning: profile/{endpoint_name} failed: {e}")
        else:
            print("  Warning: No display_name on client, skipping gear endpoints")

        # Goals endpoint needs a status argument
        for status in ["active", "future", "past"]:
            try:
                data = rate_limited_call(lambda c: c.get_goals(status), client)
                if data:
                    upsert_profile_raw(conn, f"goals_{status}", data)
                    count += 1
                    print(f"  Profile: goals_{status} saved")
            except Exception as e:
                print(f"  Warning: profile/goals_{status} failed: {e}")
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
