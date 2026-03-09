"""Session quality — automatic feedback from Garmin activity vs plan targets.

session_quality = (pace_quality + hr_quality) / 2
  pace_quality = planned_pace / actual_pace  (faster = higher)
  hr_quality = planned_hr / actual_hr  (lower HR = higher)

Feeds calibration Phase 2 correlation analysis.
"""


def compute_session_quality(
    planned_pace_sec_km: float | None,
    actual_pace_sec_km: float | None,
    planned_hr: float | None,
    actual_hr: float | None,
) -> float | None:
    """Compute session quality from planned vs actual execution.

    Returns:
        Quality score (1.0 = perfect, >1.0 = better than planned, <1.0 = worse).
        None if no valid comparison possible (rest day, missing data).
    """
    if not planned_pace_sec_km or not actual_pace_sec_km:
        return None
    if planned_pace_sec_km <= 0 or actual_pace_sec_km <= 0:
        return None

    pace_quality = planned_pace_sec_km / actual_pace_sec_km

    if planned_hr and actual_hr and planned_hr > 0 and actual_hr > 0:
        hr_quality = planned_hr / actual_hr
        return round((pace_quality + hr_quality) / 2, 4)

    return round(pace_quality, 4)
