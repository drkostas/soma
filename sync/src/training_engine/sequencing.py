"""Sequencing rules for strength + running interactions."""
from datetime import date

HARD_RUN_TYPES = {"tempo", "intervals", "threshold", "race"}
LEG_WORKOUTS = {"legs", "lower"}


def check_leg_day_conflict(
    target_date: date,
    run_type: str,
    recent_workouts: list[dict],
) -> bool:
    """Check if a hard run is scheduled within 48h of a leg workout.

    Args:
        target_date: The date of the planned run.
        run_type: Type of run (easy, tempo, intervals, etc.)
        recent_workouts: List of dicts with 'date' (date) and 'gym_workout' (str) keys.

    Returns True if there's a conflict (hard run within 48h of legs).
    """
    if run_type not in HARD_RUN_TYPES:
        return False

    for w in recent_workouts:
        w_date = w.get("date")
        gym = (w.get("gym_workout") or "").lower()
        if gym in LEG_WORKOUTS and w_date:
            days_diff = (target_date - w_date).days
            if 0 < days_diff <= 2:
                return True
    return False
