"""Tests for strength-running sequencing rules."""
from datetime import date
from training_engine.sequencing import check_leg_day_conflict


def test_no_conflict_when_no_recent_legs():
    conflict = check_leg_day_conflict(
        target_date=date(2026, 3, 15),
        run_type="intervals",
        recent_workouts=[],
    )
    assert conflict is False


def test_conflict_legs_yesterday_hard_run():
    conflict = check_leg_day_conflict(
        target_date=date(2026, 3, 15),
        run_type="intervals",
        recent_workouts=[
            {"date": date(2026, 3, 14), "gym_workout": "legs"},
        ],
    )
    assert conflict is True


def test_no_conflict_legs_3_days_ago():
    conflict = check_leg_day_conflict(
        target_date=date(2026, 3, 15),
        run_type="tempo",
        recent_workouts=[
            {"date": date(2026, 3, 12), "gym_workout": "legs"},
        ],
    )
    assert conflict is False


def test_no_conflict_push_day():
    conflict = check_leg_day_conflict(
        target_date=date(2026, 3, 15),
        run_type="intervals",
        recent_workouts=[
            {"date": date(2026, 3, 14), "gym_workout": "push"},
        ],
    )
    assert conflict is False


def test_no_conflict_easy_run():
    conflict = check_leg_day_conflict(
        target_date=date(2026, 3, 15),
        run_type="easy",
        recent_workouts=[
            {"date": date(2026, 3, 14), "gym_workout": "legs"},
        ],
    )
    assert conflict is False


def test_conflict_lower_counts():
    conflict = check_leg_day_conflict(
        target_date=date(2026, 3, 15),
        run_type="tempo",
        recent_workouts=[
            {"date": date(2026, 3, 14), "gym_workout": "lower"},
        ],
    )
    assert conflict is True
