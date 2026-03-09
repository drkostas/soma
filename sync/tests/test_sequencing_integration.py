from datetime import date
from training_engine.sequencing import check_leg_day_conflict


def test_hard_run_after_leg_day_detected():
    """Intervals 1 day after leg workout should flag conflict."""
    recent = [{"date": date(2026, 3, 7), "gym_workout": "legs"}]
    assert check_leg_day_conflict(date(2026, 3, 8), "intervals", recent) is True


def test_easy_run_after_leg_day_no_conflict():
    """Easy run after legs is fine."""
    recent = [{"date": date(2026, 3, 7), "gym_workout": "legs"}]
    assert check_leg_day_conflict(date(2026, 3, 8), "easy", recent) is False


def test_hard_run_3_days_after_legs_no_conflict():
    """3 days after legs is outside the 48h window."""
    recent = [{"date": date(2026, 3, 5), "gym_workout": "legs"}]
    assert check_leg_day_conflict(date(2026, 3, 8), "tempo", recent) is False
