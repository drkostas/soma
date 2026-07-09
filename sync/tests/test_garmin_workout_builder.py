"""Tests for the Garmin workout builder (conversion + push logic)."""

import json
from datetime import date
from unittest.mock import MagicMock, patch, call

from training_engine.garmin_workout_builder import (
    steps_to_garmin_workout,
    push_plan_to_garmin,
    _build_garmin_step,
    STEP_TYPE_MAP,
    DURATION_TYPE_MAP,
    TARGET_NO_TARGET,
    TARGET_PACE_ZONE,
)
from training_engine.plan_generator import (
    build_easy_run_steps,
    build_cruise_intervals_steps,
    build_rest_day,
)


# ===============================
# STEP TYPE MAPPING
# ===============================

def test_step_type_warmup():
    """warmup -> stepTypeId 1."""
    step = {"step_type": "warmup", "duration_type": "distance", "duration_value": 2000,
            "target_type": "open"}
    result = _build_garmin_step(1, step)
    assert result["stepType"]["stepTypeId"] == 1
    assert result["stepType"]["stepTypeKey"] == "warmup"


def test_step_type_cooldown():
    """cooldown -> stepTypeId 2."""
    step = {"step_type": "cooldown", "duration_type": "distance", "duration_value": 2000,
            "target_type": "open"}
    result = _build_garmin_step(1, step)
    assert result["stepType"]["stepTypeId"] == 2
    assert result["stepType"]["stepTypeKey"] == "cooldown"


def test_step_type_interval():
    """interval -> stepTypeId 3."""
    step = {"step_type": "interval", "duration_type": "distance", "duration_value": 1600,
            "target_type": "open"}
    result = _build_garmin_step(1, step)
    assert result["stepType"]["stepTypeId"] == 3
    assert result["stepType"]["stepTypeKey"] == "interval"


def test_step_type_recovery():
    """recovery -> stepTypeId 4."""
    step = {"step_type": "recovery", "duration_type": "time", "duration_value": 90,
            "target_type": "open"}
    result = _build_garmin_step(1, step)
    assert result["stepType"]["stepTypeId"] == 4
    assert result["stepType"]["stepTypeKey"] == "recovery"


# ===============================
# DURATION TYPE MAPPING
# ===============================

def test_duration_type_distance():
    """distance -> conditionTypeId 3."""
    step = {"step_type": "interval", "duration_type": "distance", "duration_value": 1600,
            "target_type": "open"}
    result = _build_garmin_step(1, step)
    assert result["endCondition"]["conditionTypeId"] == 3
    assert result["endCondition"]["conditionTypeKey"] == "distance"
    assert result["endConditionValue"] == 1600


def test_duration_type_time():
    """time -> conditionTypeId 2."""
    step = {"step_type": "recovery", "duration_type": "time", "duration_value": 90,
            "target_type": "open"}
    result = _build_garmin_step(1, step)
    assert result["endCondition"]["conditionTypeId"] == 2
    assert result["endCondition"]["conditionTypeKey"] == "time"
    assert result["endConditionValue"] == 90


# ===============================
# TARGET / PACE CONVERSION
# ===============================

def test_pace_target_conversion():
    """Pace target should convert sec/km to speed (m/s) for Garmin."""
    step = {
        "step_type": "interval", "duration_type": "distance", "duration_value": 1600,
        "target_type": "pace",
        "target_pace_min": 269,  # faster (4:29/km)
        "target_pace_max": 269,  # same for T-pace
    }
    result = _build_garmin_step(1, step)
    assert result["targetType"]["workoutTargetTypeId"] == 6
    assert result["targetType"]["workoutTargetTypeKey"] == "pace.zone"
    # Garmin stores pace as speed (m/s): One = slower pace = lower m/s, Two = faster = higher m/s
    assert result["targetValueOne"] == 1000 / 269  # slower pace as speed (m/s)
    assert result["targetValueTwo"] == 1000 / 269  # faster pace as speed (m/s)


def test_pace_target_range_conversion():
    """Pace range: min=faster, max=slower. Garmin: One=slower, Two=faster."""
    step = {
        "step_type": "warmup", "duration_type": "distance", "duration_value": 2000,
        "target_type": "pace",
        "target_pace_min": 322,  # faster end (5:22/km)
        "target_pace_max": 345,  # slower end (5:45/km)
    }
    result = _build_garmin_step(1, step)
    # targetValueOne = slower pace (345 sec/km) as speed m/s
    assert result["targetValueOne"] == 1000 / 345
    # targetValueTwo = faster pace (322 sec/km) as speed m/s
    assert result["targetValueTwo"] == 1000 / 322


def test_open_target():
    """Open target should use no.target with zero values."""
    step = {
        "step_type": "recovery", "duration_type": "time", "duration_value": 90,
        "target_type": "open",
    }
    result = _build_garmin_step(1, step)
    assert result["targetType"]["workoutTargetTypeId"] == 1
    assert result["targetType"]["workoutTargetTypeKey"] == "no.target"
    assert result["targetValueOne"] == 0
    assert result["targetValueTwo"] == 0


# ===============================
# FULL WORKOUT CONVERSION
# ===============================

def test_simple_easy_run():
    """Converting a simple easy run (single HR-zone step, no pace target)."""
    steps = build_easy_run_steps(8.0, 322, 345)
    workout = steps_to_garmin_workout("Week 1 Mon: Easy Run", steps)

    assert workout["workoutName"] == "Week 1 Mon: Easy Run"
    assert workout["sportType"]["sportTypeId"] == 1
    assert workout["sportType"]["sportTypeKey"] == "running"
    assert len(workout["workoutSegments"]) == 1

    segment = workout["workoutSegments"][0]
    assert segment["segmentOrder"] == 1
    assert segment["sportType"]["sportTypeKey"] == "running"

    garmin_steps = segment["workoutSteps"]
    assert len(garmin_steps) == 1

    step = garmin_steps[0]
    assert step["type"] == "ExecutableStepDTO"
    assert step["stepOrder"] == 1
    assert step["stepType"]["stepTypeKey"] == "warmup"
    assert step["endCondition"]["conditionTypeKey"] == "distance"
    assert step["endConditionValue"] == 8000  # 8 km in meters
    # easy runs are HR-zone only (zone 2), no pace target
    assert step["targetType"]["workoutTargetTypeKey"] == "heart.rate.zone"
    assert step["zoneNumber"] == 2
    assert step["targetValueOne"] is None
    assert step["targetValueTwo"] is None
    assert "Easy 8.0 km" in step["description"]


def test_cruise_intervals_conversion():
    """Converting cruise intervals (warmup + intervals + recovery + cooldown)."""
    steps = build_cruise_intervals_steps(
        reps=4, rep_distance_m=1600, t_pace=269, recovery_sec=90,
        wu_km=2.0, cd_km=2.0, e_pace_min=322, e_pace_max=345,
    )
    workout = steps_to_garmin_workout("Week 1 Tue: Cruise Intervals", steps)

    garmin_steps = workout["workoutSegments"][0]["workoutSteps"]
    # warmup + lap-button + repeat group (4×[interval + recovery]) + cooldown = 4 top-level
    assert len(garmin_steps) == 4

    # Warmup — HR zone 2
    wu = garmin_steps[0]
    assert wu["stepType"]["stepTypeKey"] == "warmup"
    assert wu["endCondition"]["conditionTypeKey"] == "distance"
    assert wu["endConditionValue"] == 2000
    assert wu["targetType"]["workoutTargetTypeKey"] == "heart.rate.zone"
    assert wu["zoneNumber"] == 2

    # Lap-button rest to start the intervals
    lap = garmin_steps[1]
    assert lap["stepType"]["stepTypeKey"] == "rest"
    assert lap["targetType"]["workoutTargetTypeKey"] == "no.target"

    # Repeat group of the 4 intervals (each followed by a recovery jog)
    grp = garmin_steps[2]
    assert grp["type"] == "RepeatGroupDTO"
    assert grp["numberOfIterations"] == 4
    interval, recovery = grp["workoutSteps"][0], grp["workoutSteps"][1]
    assert interval["stepType"]["stepTypeKey"] == "interval"
    assert interval["endConditionValue"] == 1600
    assert interval["targetType"]["workoutTargetTypeKey"] == "pace.zone"
    # T-pace 269 sec/km ± PACE_RANGE(7) → speed m/s (slower first, faster second)
    assert interval["targetValueOne"] == 1000 / 276
    assert interval["targetValueTwo"] == 1000 / 262
    assert recovery["stepType"]["stepTypeKey"] == "recovery"
    assert recovery["endConditionValue"] == 90
    assert recovery["targetType"]["workoutTargetTypeKey"] == "heart.rate.zone"

    # Cooldown (last step) — HR zone 2
    cd = garmin_steps[-1]
    assert cd["stepType"]["stepTypeKey"] == "cooldown"
    assert cd["endConditionValue"] == 2000
    assert cd["targetType"]["workoutTargetTypeKey"] == "heart.rate.zone"


def test_rest_day_none_steps():
    """Rest day produces None steps — should not be passed to the builder."""
    steps = build_rest_day()
    assert steps is None


def test_workout_name_formatting():
    """Workout name should be passed through as-is."""
    steps = build_easy_run_steps(5.0, 322, 345)
    workout = steps_to_garmin_workout("W3 Sat: Long Run (Progression)", steps)
    assert workout["workoutName"] == "W3 Sat: Long Run (Progression)"


def test_workout_description():
    """Optional description should be included in payload."""
    steps = build_easy_run_steps(5.0, 322, 345)
    workout = steps_to_garmin_workout("Test", steps, description="Test description")
    assert workout["description"] == "Test description"


def test_workout_no_description():
    """No description key when not provided."""
    steps = build_easy_run_steps(5.0, 322, 345)
    workout = steps_to_garmin_workout("Test", steps)
    assert "description" not in workout


def test_step_description_preserved():
    """Step-level descriptions should be preserved."""
    steps = [
        {"step_type": "warmup", "duration_type": "distance", "duration_value": 2000,
         "target_type": "pace", "target_pace_min": 322, "target_pace_max": 345,
         "description": "Easy warmup"},
    ]
    workout = steps_to_garmin_workout("Test", steps)
    assert workout["workoutSegments"][0]["workoutSteps"][0]["description"] == "Easy warmup"


# ===============================
# PUSH FUNCTION (MOCKED)
# ===============================

def test_push_plan_to_garmin_basic():
    """Push function should upload and schedule workouts, update DB status."""
    # Mock connection
    mock_conn = MagicMock()
    mock_cursor = MagicMock()
    mock_conn.cursor.return_value.__enter__ = MagicMock(return_value=mock_cursor)
    mock_conn.cursor.return_value.__exit__ = MagicMock(return_value=False)

    # DB returns one pending day with workout steps
    easy_steps = build_easy_run_steps(8.0, 322, 345)
    mock_cursor.fetchall.return_value = [
        (101, date(2026, 3, 10), "Easy Run", easy_steps),
    ]
    mock_cursor.fetchone.return_value = (1,)  # week_number

    # Mock Garmin client — garminconnect 0.3.0 exposes the inner HTTP client
    # at ``client.client`` (replaces the old ``client.garth`` path).
    mock_client = MagicMock()
    mock_client.upload_workout.return_value = {"workoutId": 12345}
    mock_client_post = MagicMock()
    mock_client.client.post = mock_client_post

    with patch("garmin_client.rate_limited_call") as mock_rlc:
        # rate_limited_call should call the function and return its result
        def side_effect(func, *args, **kwargs):
            return func(*args, **kwargs)
        mock_rlc.side_effect = side_effect

        result = push_plan_to_garmin(mock_conn, mock_client, plan_id=1)

    assert result == 1

    # Verify upload_workout was called
    mock_client.upload_workout.assert_called_once()
    payload = mock_client.upload_workout.call_args[0][0]
    assert "Easy Run" in payload["workoutName"]
    assert payload["sportType"]["sportTypeKey"] == "running"

    # Verify scheduling was called via the new .client.post path
    mock_client_post.assert_called_once()
    schedule_args = mock_client_post.call_args
    assert "schedule" in schedule_args[0][1]
    assert schedule_args[1]["json"]["date"] == "2026-03-10"


def test_push_plan_skips_none_steps():
    """Push function should skip days with no workout_steps (rest days)."""
    mock_conn = MagicMock()
    mock_cursor = MagicMock()
    mock_conn.cursor.return_value.__enter__ = MagicMock(return_value=mock_cursor)
    mock_conn.cursor.return_value.__exit__ = MagicMock(return_value=False)

    # DB query already filters WHERE workout_steps IS NOT NULL,
    # but fetchall returns empty since no rows match
    mock_cursor.fetchall.return_value = []

    mock_client = MagicMock()

    with patch("garmin_client.rate_limited_call"):
        result = push_plan_to_garmin(mock_conn, mock_client, plan_id=1)

    assert result == 0
    mock_client.upload_workout.assert_not_called()


def test_push_plan_handles_failure():
    """If one workout fails, continue with the rest and mark as failed."""
    mock_conn = MagicMock()
    mock_cursor = MagicMock()
    mock_conn.cursor.return_value.__enter__ = MagicMock(return_value=mock_cursor)
    mock_conn.cursor.return_value.__exit__ = MagicMock(return_value=False)

    easy_steps = build_easy_run_steps(8.0, 322, 345)
    cruise_steps = build_cruise_intervals_steps(
        reps=4, rep_distance_m=1600, t_pace=269, recovery_sec=90,
        wu_km=2.0, cd_km=2.0, e_pace_min=322, e_pace_max=345,
    )

    mock_cursor.fetchall.return_value = [
        (101, date(2026, 3, 10), "Easy Run", easy_steps),
        (102, date(2026, 3, 11), "Cruise Intervals", cruise_steps),
    ]
    mock_cursor.fetchone.return_value = (1,)  # week_number

    # First upload fails, second succeeds
    mock_client = MagicMock()
    upload_call_count = [0]

    def upload_side_effect(payload):
        upload_call_count[0] += 1
        if upload_call_count[0] == 1:
            raise Exception("API error")
        return {"workoutId": 99999}

    mock_client.upload_workout.side_effect = upload_side_effect

    with patch("garmin_client.rate_limited_call") as mock_rlc:
        def side_effect(func, *args, **kwargs):
            return func(*args, **kwargs)
        mock_rlc.side_effect = side_effect

        result = push_plan_to_garmin(mock_conn, mock_client, plan_id=1)

    # One succeeded, one failed
    assert result == 1

    # DB should have been updated for both: failed + pushed
    update_calls = [
        c for c in mock_cursor.execute.call_args_list
        if c[0][0].strip().startswith("UPDATE")
    ]
    assert len(update_calls) == 2

    # First update should be 'failed'
    assert "failed" in update_calls[0][0][0]
    # Second update should be 'pushed'
    assert "pushed" in update_calls[1][0][0]
