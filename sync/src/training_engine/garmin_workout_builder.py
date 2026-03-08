"""Convert training plan workout steps to Garmin Connect structured workouts.

Translates our workout_steps JSONB format (from plan_generator.py) into
Garmin's workout API payload and handles pushing + scheduling plan days.
"""

import json
import logging

logger = logging.getLogger(__name__)

# ===============================
# GARMIN API CONSTANTS
# ===============================

STEP_TYPE_MAP = {
    "warmup":   {"stepTypeId": 1, "stepTypeKey": "warmup"},
    "cooldown": {"stepTypeId": 2, "stepTypeKey": "cooldown"},
    "interval": {"stepTypeId": 3, "stepTypeKey": "interval"},
    "recovery": {"stepTypeId": 4, "stepTypeKey": "recovery"},
    "rest":     {"stepTypeId": 5, "stepTypeKey": "rest"},
}

DURATION_TYPE_MAP = {
    "time":     {"conditionTypeId": 2, "conditionTypeKey": "time"},
    "distance": {"conditionTypeId": 3, "conditionTypeKey": "distance"},
}

TARGET_NO_TARGET = {"workoutTargetTypeId": 1, "workoutTargetTypeKey": "no.target"}
TARGET_PACE_ZONE = {"workoutTargetTypeId": 6, "workoutTargetTypeKey": "pace.zone"}

SPORT_RUNNING = {"sportTypeId": 1, "sportTypeKey": "running"}


# ===============================
# WORKOUT BUILDER
# ===============================

def _build_garmin_step(order: int, step: dict) -> dict:
    """Convert a single workout step to Garmin's ExecutableStepDTO format.

    Args:
        order: 1-based step order.
        step: Our step dict with step_type, duration_type, duration_value, etc.

    Returns:
        Garmin step dict.
    """
    step_type = STEP_TYPE_MAP.get(step["step_type"], STEP_TYPE_MAP["interval"])

    duration_type = step.get("duration_type", "distance")
    end_condition = DURATION_TYPE_MAP.get(duration_type, DURATION_TYPE_MAP["distance"])

    # Duration value: meters for distance, seconds for time — passed as-is
    end_condition_value = step.get("duration_value", 0)

    # Target
    target_type = step.get("target_type", "open")
    if target_type == "pace" and step.get("target_pace_min") is not None:
        target = TARGET_PACE_ZONE.copy()
        pace_min = step["target_pace_min"]  # sec/km (faster = lower number)
        pace_max = step["target_pace_max"]  # sec/km (slower = higher number)
        # Garmin: targetValueOne = SLOWER pace (higher), targetValueTwo = FASTER pace (lower)
        # Both in milliseconds per km
        target_value_one = pace_max * 1000  # slower pace
        target_value_two = pace_min * 1000  # faster pace
    else:
        target = TARGET_NO_TARGET.copy()
        target_value_one = 0
        target_value_two = 0

    return {
        "type": "ExecutableStepDTO",
        "stepOrder": order,
        "stepType": step_type,
        "endCondition": end_condition,
        "endConditionValue": end_condition_value,
        "targetType": target,
        "targetValueOne": target_value_one,
        "targetValueTwo": target_value_two,
        "description": step.get("description", ""),
    }


def steps_to_garmin_workout(name: str, steps: list[dict], description: str = "") -> dict:
    """Convert our workout_steps to Garmin workout API payload.

    Args:
        name: Workout name (e.g. "Week 1 Tue: Cruise Intervals").
        steps: List of step dicts from plan_generator.py.
        description: Optional workout description.

    Returns:
        Garmin workout API payload dict ready for upload_workout().
    """
    garmin_steps = []
    for i, step in enumerate(steps):
        garmin_steps.append(_build_garmin_step(i + 1, step))

    payload = {
        "workoutName": name,
        "sportType": SPORT_RUNNING.copy(),
        "workoutSegments": [{
            "segmentOrder": 1,
            "sportType": SPORT_RUNNING.copy(),
            "workoutSteps": garmin_steps,
        }],
    }

    if description:
        payload["description"] = description

    return payload


# ===============================
# PUSH TO GARMIN
# ===============================

def push_plan_to_garmin(conn, client, plan_id: int) -> int:
    """Push all pending workout days from a training plan to Garmin Connect.

    For each training_plan_day where plan_id matches and garmin_push_status = 'none'
    and workout_steps is not None:
      1. Build Garmin workout JSON from workout_steps
      2. Upload via client.upload_workout(payload)
      3. Schedule on target date via garth.post
      4. Update training_plan_day with garmin_push_status = 'pushed'

    Args:
        conn: psycopg2 connection.
        client: Initialized Garmin client.
        plan_id: ID of the training plan.

    Returns:
        Number of workouts successfully pushed.
    """
    from garmin_client import rate_limited_call

    with conn.cursor() as cur:
        cur.execute("""
            SELECT id, day_date, run_title, workout_steps
            FROM training_plan_day
            WHERE plan_id = %s
              AND garmin_push_status = 'none'
              AND workout_steps IS NOT NULL
            ORDER BY day_date
        """, (plan_id,))
        rows = cur.fetchall()

    pushed = 0
    for day_id, day_date, run_title, workout_steps_raw in rows:
        # Parse workout_steps if needed
        if isinstance(workout_steps_raw, str):
            steps = json.loads(workout_steps_raw)
        elif isinstance(workout_steps_raw, list):
            steps = workout_steps_raw
        else:
            # Already a dict/list from psycopg2 JSONB
            steps = workout_steps_raw

        if not steps:
            continue

        workout_name = f"W{_get_week_number(conn, day_id)} {_day_abbrev(day_date)}: {run_title}"
        payload = steps_to_garmin_workout(workout_name, steps)

        try:
            # Upload workout
            result = rate_limited_call(client.upload_workout, payload)
            garmin_id = str(result.get("workoutId", "")) if result else ""

            # Schedule on target date
            if garmin_id:
                schedule_url = f"/workout-service/schedule/{garmin_id}"
                schedule_body = {"date": day_date.isoformat()}
                rate_limited_call(
                    client.garth.post,
                    "connectapi", schedule_url, json=schedule_body, api=True,
                )

            # Mark as pushed
            with conn.cursor() as cur:
                cur.execute("""
                    UPDATE training_plan_day
                    SET garmin_push_status = 'pushed',
                        garmin_workout_id = %s
                    WHERE id = %s
                """, (garmin_id or None, day_id))
            conn.commit()
            pushed += 1
            logger.info("Pushed day %s (%s) -> Garmin workout %s", day_id, workout_name, garmin_id)

        except Exception as e:
            # Mark as failed but continue with other days
            with conn.cursor() as cur:
                cur.execute("""
                    UPDATE training_plan_day
                    SET garmin_push_status = 'failed'
                    WHERE id = %s
                """, (day_id,))
            conn.commit()
            logger.error("Failed to push day %s (%s): %s", day_id, workout_name, e)

    return pushed


def _get_week_number(conn, day_id: int) -> int:
    """Get the week_number for a training_plan_day."""
    with conn.cursor() as cur:
        cur.execute("SELECT week_number FROM training_plan_day WHERE id = %s", (day_id,))
        row = cur.fetchone()
        return row[0] if row else 0


def _day_abbrev(day_date) -> str:
    """Return 3-letter day abbreviation for a date."""
    return day_date.strftime("%a")
