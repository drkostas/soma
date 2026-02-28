"""Sync daily health data from Garmin Connect to the database."""

from datetime import date, timedelta

from garmin_client import init_garmin, rate_limited_call
from db import get_connection, upsert_raw_data, upsert_activity_raw, log_sync


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
            # Store each activity as a 'summary' record (required by web queries)
            for activity in activities:
                aid = activity.get("activityId")
                if aid:
                    upsert_activity_raw(conn, aid, "summary", activity)
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


_STEP_TYPE_MAP = {
    "warmup": "warmup", "cooldown": "cooldown",
    "interval": "interval", "recovery": "recovery", "rest": "rest",
    "active": "aerobic",
}


def _step_duration(condition: str, end_val: float) -> int:
    if condition == "time":
        return max(int(end_val), 30)
    elif condition == "distance":
        return max(int(float(end_val) / 1000 * 330), 30)  # 5:30/km estimate
    return 600  # lap button / unknown


def _parse_workout_steps(steps: list) -> list:
    """Parse Garmin step DTOs into hierarchical segment format.
    Repeat groups are preserved (not expanded). 'other' type steps are skipped.
    Returns: list of { type, duration_s } or { type: "repeat", repeat_count, children: [...] }
    """
    result = []
    for step in steps:
        step_type = step.get("stepType", {}).get("stepTypeKey", "active")
        if step_type == "other":
            continue  # lap-button prompts / transitions
        if step_type == "repeat":
            n = int(step.get("numberOfIterations") or 1)
            children = _parse_workout_steps(step.get("workoutSteps") or [])
            if children:
                result.append({"type": "repeat", "repeat_count": n, "children": children})
            continue
        condition = step.get("endCondition", {}).get("conditionTypeKey", "time")
        end_val = step.get("endConditionValue") or 0
        result.append({
            "type": _STEP_TYPE_MAP.get(step_type, "aerobic"),
            "duration_s": _step_duration(condition, end_val),
        })
    return result


def _workout_steps_summary(parsed: list) -> str:
    """Generate human-readable summary from parsed hierarchical segment data."""
    parts = []
    for item in parsed:
        if item.get("type") == "repeat":
            n = item.get("repeat_count", 1)
            inner = _workout_steps_summary(item.get("children", []))
            parts.append(f"{n}×[{inner}]")
        else:
            d = item.get("duration_s", 0)
            mins, secs = divmod(int(d), 60)
            dur = f"{mins}:{secs:02d}" if secs else f"{mins} min"
            parts.append(f"{item.get('type', 'aerobic').capitalize()} {dur}")
    return " · ".join(parts)


def sync_garmin_workouts(client) -> int:
    """Sync structured workouts (training templates) from Garmin Connect to DB."""
    import json
    workouts = rate_limited_call(client.get_workouts, 0, 100)
    if not workouts:
        return 0

    count = 0
    with get_connection() as conn:
        with conn.cursor() as cur:
            for w in workouts:
                workout_id = str(w.get("workoutId", ""))
                if not workout_id:
                    continue
                sport_type = w.get("sportType", {}).get("sportTypeKey", "running")

                # Fetch full workout detail to get workoutSegments + steps
                try:
                    detail = rate_limited_call(client.get_workout_by_id, workout_id)
                except Exception:
                    detail = w

                # Parse all steps from all segments
                all_steps = []
                for seg in detail.get("workoutSegments", []):
                    all_steps.extend(seg.get("workoutSteps", []))
                segments = _parse_workout_steps(all_steps)
                summary = _workout_steps_summary(segments)

                cur.execute("""
                    INSERT INTO garmin_workouts
                        (workout_id, workout_name, sport_type, steps_summary, segments, raw_json, synced_at)
                    VALUES (%s, %s, %s, %s, %s, %s, NOW())
                    ON CONFLICT (workout_id) DO UPDATE SET
                        workout_name = EXCLUDED.workout_name,
                        sport_type = EXCLUDED.sport_type,
                        steps_summary = EXCLUDED.steps_summary,
                        segments = EXCLUDED.segments,
                        raw_json = EXCLUDED.raw_json,
                        synced_at = NOW()
                """, (
                    workout_id,
                    detail.get("workoutName", w.get("workoutName", "Workout")),
                    sport_type,
                    summary,
                    json.dumps(segments),
                    json.dumps(detail),
                ))
                count += 1
        conn.commit()
    return count


def _segments_to_garmin_workout(name: str, segments: list) -> dict:
    """Convert our segment format to a Garmin workout payload."""
    STEP_TYPE_MAP = {
        "warmup":   {"stepTypeId": 1, "stepTypeKey": "warmup"},
        "cooldown": {"stepTypeId": 2, "stepTypeKey": "cooldown"},
        "interval": {"stepTypeId": 3, "stepTypeKey": "interval"},
        "recovery": {"stepTypeId": 4, "stepTypeKey": "recovery"},
        "rest":     {"stepTypeId": 5, "stepTypeKey": "rest"},
        "aerobic":  {"stepTypeId": 6, "stepTypeKey": "active"},
        "easy":     {"stepTypeId": 6, "stepTypeKey": "active"},
        "tempo":    {"stepTypeId": 3, "stepTypeKey": "interval"},
        "vo2max":   {"stepTypeId": 3, "stepTypeKey": "interval"},
        "strides":  {"stepTypeId": 3, "stepTypeKey": "interval"},
    }
    NO_TARGET = {"workoutTargetTypeId": 1, "workoutTargetTypeKey": "no.target"}
    TIME_COND = {"conditionTypeId": 2, "conditionTypeKey": "time"}

    steps = []
    for i, seg in enumerate(segments):
        steps.append({
            "stepId": i + 1,
            "stepOrder": i + 1,
            "stepType": STEP_TYPE_MAP.get(seg.get("type", "aerobic"), STEP_TYPE_MAP["aerobic"]),
            "conditionType": TIME_COND,
            "endConditionValue": int(seg.get("duration_s", 600)),
            "targetType": NO_TARGET,
            "targetValueOne": 0,
            "targetValueTwo": 0,
            "description": "",
        })

    return {
        "workoutName": name,
        "sportType": {"sportTypeId": 1, "sportTypeKey": "running"},
        "workoutSegments": [{
            "segmentOrder": 1,
            "sportType": {"sportTypeId": 1, "sportTypeKey": "running"},
            "workoutSteps": steps,
        }],
    }


def push_pending_plans(client) -> int:
    """Push workout_plans with garmin_push_status='pending' to Garmin Connect."""
    import json
    pushed = 0
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, name, segments FROM workout_plans
                WHERE garmin_push_status = 'pending'
                ORDER BY created_at DESC
                LIMIT 10
            """)
            rows = cur.fetchall()

        for plan_id, name, segments_raw in rows:
            segs = segments_raw if isinstance(segments_raw, list) else json.loads(segments_raw)
            payload = _segments_to_garmin_workout(name, segs)
            try:
                result = rate_limited_call(client.add_workout, payload)
                garmin_id = str(result.get("workoutId", "")) if result else ""
                with conn.cursor() as cur:
                    cur.execute("""
                        UPDATE workout_plans SET
                            garmin_workout_id = %s,
                            garmin_push_status = 'pushed'
                        WHERE id = %s
                    """, (garmin_id or None, plan_id))
                    conn.commit()
                pushed += 1
                print(f"  Pushed plan {plan_id} ({name}) → Garmin workout {garmin_id}")
            except Exception as e:
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE saved_plans SET garmin_push_status='failed' WHERE id=%s",
                        (plan_id,)
                    )
                    conn.commit()
                print(f"  Failed to push plan {plan_id}: {e}")
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE workout_plans SET garmin_push_status='failed' WHERE id=%s",
                        (plan_id,)
                    )
                    conn.commit()
    return pushed


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
