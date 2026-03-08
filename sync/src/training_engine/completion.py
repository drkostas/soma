"""Completion scoring — match Garmin activities to plan days and score compliance.

Scores how well the athlete followed the training plan by comparing actual
activity data against planned targets (pace, distance, heart rate).
"""

RUNNING_TYPES = {"running", "trail_running", "treadmill_running"}


def match_activity_to_plan(plan_day: dict, activities: list[dict]) -> dict | None:
    """Match a Garmin activity to a plan day by date.

    Filters activities to running types on the plan day's date. If multiple
    running activities exist on the same date, picks the one closest to the
    planned distance.

    Args:
        plan_day: Dict with keys: day_date (str YYYY-MM-DD), run_type, target_distance_km.
        activities: List of dicts with: date, type, distance_m, etc.

    Returns:
        Matched activity dict, or None if no match.
    """
    target_date = plan_day["day_date"]
    target_distance_m = plan_day["target_distance_km"] * 1000

    candidates = [
        a for a in activities
        if a["date"] == target_date and a.get("type", "") in RUNNING_TYPES
    ]

    if not candidates:
        return None

    if len(candidates) == 1:
        return candidates[0]

    # Multiple running activities — pick closest by distance
    return min(candidates, key=lambda a: abs(a.get("distance_m", 0) - target_distance_m))


def score_pace_compliance(actual_pace: float, target_min: float, target_max: float) -> float:
    """Score pace compliance 0-100.

    100 if within [target_min, target_max]. Linear decay outside the range,
    reaching 0 at 20% deviation from the nearest boundary.

    Formula: max(0, 100 * (1 - deviation * 5))
    where deviation = distance from nearest boundary / that boundary.
    """
    if target_min <= actual_pace <= target_max:
        return 100

    if actual_pace < target_min:
        deviation = (target_min - actual_pace) / target_min
    else:
        deviation = (actual_pace - target_max) / target_max

    return max(0, round(100 * (1 - deviation * 5), 2))


def score_distance_compliance(actual_km: float, target_km: float) -> float:
    """Score distance compliance 0-100.

    100 if exact match. Linear decay based on ratio deviation.
    Formula: max(0, 100 * (1 - abs(1 - ratio) * 3.33))
    30% off = 0. Returns 100 if target_km <= 0.
    """
    if target_km <= 0:
        return 100

    ratio = actual_km / target_km
    deviation = abs(1 - ratio)
    return max(0, round(100 * (1 - deviation * 3.33), 2))


def score_hr_compliance(actual_avg_hr: float, target_hr_min: float | None,
                        target_hr_max: float | None) -> float:
    """Score heart rate compliance 0-100.

    100 if within zone or if no targets specified (None).
    Same linear decay as pace: 20% deviation from boundary = 0.
    """
    if target_hr_min is None or target_hr_max is None:
        return 100

    if target_hr_min <= actual_avg_hr <= target_hr_max:
        return 100

    if actual_avg_hr < target_hr_min:
        deviation = (target_hr_min - actual_avg_hr) / target_hr_min
    else:
        deviation = (actual_avg_hr - target_hr_max) / target_hr_max

    return max(0, round(100 * (1 - deviation * 5), 2))


def compute_completion_score(plan_step: dict, actual: dict | None,
                             pace_weight: float = 0.50,
                             distance_weight: float = 0.30,
                             hr_weight: float = 0.20) -> float:
    """Compute weighted completion score from pace, distance, and HR compliance.

    Args:
        plan_step: Dict with keys: target_pace_min, target_pace_max,
                   target_distance_km, target_hr_min (optional), target_hr_max (optional).
        actual: Dict with: avg_pace_sec_km, distance_km, avg_hr. None if no activity.
        pace_weight: Weight for pace compliance (default 0.50).
        distance_weight: Weight for distance compliance (default 0.30).
        hr_weight: Weight for HR compliance (default 0.20).

    Returns:
        Weighted score 0-100.
    """
    if actual is None:
        return 0

    pace_score = score_pace_compliance(
        actual["avg_pace_sec_km"],
        plan_step["target_pace_min"],
        plan_step["target_pace_max"],
    )

    distance_score = score_distance_compliance(
        actual["distance_km"],
        plan_step["target_distance_km"],
    )

    hr_score = score_hr_compliance(
        actual["avg_hr"],
        plan_step.get("target_hr_min"),
        plan_step.get("target_hr_max"),
    )

    return round(
        pace_score * pace_weight
        + distance_score * distance_weight
        + hr_score * hr_weight,
        2,
    )
