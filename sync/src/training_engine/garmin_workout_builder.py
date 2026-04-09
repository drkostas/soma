"""Convert training plan workout steps to Garmin Connect structured workouts.

Translates our workout_steps JSONB format (from plan_generator.py) into
Garmin's workout API payload and handles pushing + scheduling plan days.
"""

import json
import logging
import re

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
    "time":       {"conditionTypeId": 2, "conditionTypeKey": "time"},
    "distance":   {"conditionTypeId": 3, "conditionTypeKey": "distance"},
    "lap_button": {"conditionTypeId": 1, "conditionTypeKey": "lap.button"},
}

TARGET_NO_TARGET = {"workoutTargetTypeId": 1, "workoutTargetTypeKey": "no.target"}
TARGET_PACE_ZONE = {"workoutTargetTypeId": 6, "workoutTargetTypeKey": "pace.zone"}
TARGET_HR_ZONE = {"workoutTargetTypeId": 4, "workoutTargetTypeKey": "heart.rate.zone"}

SPORT_RUNNING = {"sportTypeId": 1, "sportTypeKey": "running"}


# ===============================
# WORKOUT BUILDER
# ===============================

def _pace_sec_km_to_ms(pace_sec_per_km: float) -> float:
    """Convert pace in sec/km to speed in m/s for Garmin API."""
    if pace_sec_per_km <= 0:
        return 0.0
    return 1000.0 / pace_sec_per_km


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
    if duration_type == "lap_button":
        end_condition = DURATION_TYPE_MAP["lap_button"]
        end_condition_value = None
    else:
        end_condition = DURATION_TYPE_MAP.get(duration_type, DURATION_TYPE_MAP["distance"])
        end_condition_value = step.get("duration_value", 0)

    # Target: convert sec/km to m/s for Garmin API
    target_type = step.get("target_type", "open")
    if target_type == "pace" and step.get("target_pace_min") is not None:
        target = TARGET_PACE_ZONE.copy()
        pace_min = step["target_pace_min"]  # sec/km (faster = lower number)
        pace_max = step["target_pace_max"]  # sec/km (slower = higher number)
        # Garmin: targetValueOne = SLOWER speed (m/s), targetValueTwo = FASTER speed (m/s)
        target_value_one = _pace_sec_km_to_ms(pace_max)  # slower pace → lower m/s
        target_value_two = _pace_sec_km_to_ms(pace_min)  # faster pace → higher m/s
    elif target_type == "hr" and step.get("hr_zone") is not None:
        # HR zone as primary target (used for recovery jogs)
        target = TARGET_HR_ZONE.copy()
        target_value_one = None
        target_value_two = None
    else:
        target = TARGET_NO_TARGET.copy()
        target_value_one = 0
        target_value_two = 0

    result = {
        "type": "ExecutableStepDTO",
        "stepOrder": order,
        "stepType": step_type,
        "endCondition": end_condition,
        "targetType": target,
        "targetValueOne": target_value_one,
        "targetValueTwo": target_value_two,
        "description": step.get("description", ""),
    }
    if end_condition_value is not None:
        result["endConditionValue"] = end_condition_value

    # HR zone handling: primary (for recovery jogs) or secondary (for pace-targeted steps)
    hr_zone = step.get("hr_zone")
    if hr_zone is not None and target_type == "hr":
        # HR is the primary target — set zone on primary (already set above)
        result["zoneNumber"] = hr_zone
    elif hr_zone is not None:
        # HR as secondary target (pace is primary)
        result["secondaryTargetType"] = TARGET_HR_ZONE.copy()
        result["secondaryTargetValueOne"] = None
        result["secondaryTargetValueTwo"] = None
        result["secondaryZoneNumber"] = hr_zone

    return result


def _detect_repeat_groups(steps: list[dict]) -> list[dict]:
    """Detect repeated stride+recovery patterns and wrap in RepeatGroupDTO.

    Looks for consecutive pairs of (interval + recovery) where the interval
    descriptions match a "N/M" pattern (e.g., "Stride 1/6", "Stride 2/6").
    Wraps them in a Garmin repeat group.
    """
    if len(steps) < 4:
        return steps

    result = []
    i = 0
    while i < len(steps):
        # Look for stride/rep pattern: interval + recovery repeating
        rep_pattern = re.compile(r"(\d+)/(\d+)")
        step = steps[i]
        desc = step.get("description", "")
        match = rep_pattern.search(desc)

        if (match and step["step_type"] == "interval"
                and int(match.group(1)) == 1):  # starts at 1/N
            total_reps = int(match.group(2))
            # Collect the interval+recovery pair
            pair_steps = []
            expected_idx = 1
            j = i
            while j < len(steps) and expected_idx <= total_reps:
                s = steps[j]
                s_desc = s.get("description", "")
                s_match = rep_pattern.search(s_desc)
                if s.get("step_type") == "interval" and s_match and int(s_match.group(1)) == expected_idx:
                    if expected_idx == 1:
                        pair_steps.append(s)
                    j += 1
                    # Check for recovery after (except after last rep)
                    if j < len(steps) and steps[j].get("step_type") in ("recovery", "rest"):
                        if expected_idx == 1:
                            pair_steps.append(steps[j])
                        j += 1
                    expected_idx += 1
                else:
                    break

            if expected_idx > total_reps and len(pair_steps) >= 1:
                # Successfully found all reps — create repeat group
                result.append({
                    "type": "repeat",
                    "iterations": total_reps,
                    "steps": pair_steps,
                })
                i = j
                continue

        result.append(step)
        i += 1

    return result


def steps_to_garmin_workout(name: str, steps: list[dict], description: str = "") -> dict:
    """Convert our workout_steps to Garmin workout API payload.

    Args:
        name: Workout name (e.g. "Week 1 Tue: Cruise Intervals").
        steps: List of step dicts from plan_generator.py.
        description: Optional workout description.

    Returns:
        Garmin workout API payload dict ready for upload_workout().
    """
    # Detect repeating patterns and group them
    grouped = _detect_repeat_groups(steps)

    garmin_steps = []
    order = 1
    for item in grouped:
        if item.get("type") == "repeat":
            # Build RepeatGroupDTO
            inner_steps = []
            inner_order = 1
            for inner in item["steps"]:
                inner_steps.append(_build_garmin_step(inner_order, inner))
                inner_order += 1
            garmin_steps.append({
                "type": "RepeatGroupDTO",
                "stepOrder": order,
                "numberOfIterations": item["iterations"],
                "smartRepeat": False,
                "workoutSteps": inner_steps,
            })
        else:
            garmin_steps.append(_build_garmin_step(order, item))
        order += 1

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

    For each training_plan_day where plan_id matches and garmin_push_status
    is 'none' or 'pending' and workout_steps is not None:
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
              AND garmin_push_status IN ('none', 'pending')
              AND workout_steps IS NOT NULL
            ORDER BY day_date
        """, (plan_id,))
        rows = cur.fetchall()

    logger.info("Found %d pending workouts to push for plan %d", len(rows), plan_id)
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
                    client.client.post,
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
