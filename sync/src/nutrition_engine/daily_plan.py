"""Daily nutrition plan generator — Task 5.

Classifies sleep quality, adjusts caloric deficit based on recovery,
and generates a complete daily macro plan.
"""

from __future__ import annotations

from nutrition_engine.tdee import compute_macro_targets


# ---------------------------------------------------------------------------
# Sleep quality classification
# ---------------------------------------------------------------------------

def classify_sleep_quality(
    total_seconds: float,
    deep_seconds: float,
    garmin_score: float,
) -> float:
    """Compute a composite sleep quality score (0-100).

    Formula: 0.5 * duration_score + 0.25 * deep_score + 0.25 * garmin_score

    Duration scoring:
        - 8h+ = 100
        - 5-8h = linear 0-100
        - <5h = 0

    Deep sleep scoring:
        - 1.5h+ = 100
        - 0.5-1.5h = linear 0-100
        - <0.5h = 0
    """
    total_hours = total_seconds / 3600.0
    deep_hours = deep_seconds / 3600.0

    # Duration score
    if total_hours >= 8:
        duration_score = 100.0
    elif total_hours >= 5:
        duration_score = (total_hours - 5) / (8 - 5) * 100.0
    else:
        duration_score = 0.0

    # Deep sleep score
    if deep_hours >= 1.5:
        deep_score = 100.0
    elif deep_hours >= 0.5:
        deep_score = (deep_hours - 0.5) / (1.5 - 0.5) * 100.0
    else:
        deep_score = 0.0

    # Clamp garmin_score to [0, 100]
    garmin_score = max(0.0, min(100.0, garmin_score))

    composite = 0.5 * duration_score + 0.25 * deep_score + 0.25 * garmin_score
    return max(0.0, min(100.0, composite))


# ---------------------------------------------------------------------------
# Deficit adjustment
# ---------------------------------------------------------------------------

def adjust_deficit_for_sleep(deficit: float, sleep_score: float) -> float:
    """Adjust caloric deficit based on sleep quality score.

    - score >= 50 → no change
    - score 30-49 → halve the deficit
    - score < 30 → zero (maintenance calories)
    """
    if sleep_score >= 50:
        return deficit
    elif sleep_score >= 30:
        return deficit / 2
    else:
        return 0.0


# ---------------------------------------------------------------------------
# Daily plan generator
# ---------------------------------------------------------------------------

def generate_daily_plan(
    tdee: float,
    deficit: float,
    weight_kg: float,
    training_day_type: str,
    sleep_quality_score: float,
    protein_g_per_kg: float = 2.2,
    fat_g_per_kg: float = 0.8,
    estimated_bf_pct: float | None = None,
    ffm_kg: float | None = None,
    is_refeed: bool = False,
) -> dict:
    """Generate a complete daily nutrition plan.

    Adjusts the deficit based on sleep quality, then delegates to
    ``compute_macro_targets`` for the actual macro computation.

    Returns:
        Dict with target macros plus metadata (tdee_used, deficit_used,
        adjustment_reason, sleep_quality_score, training_day_type, is_refeed).
    """
    # Determine adjustment reason and adjusted deficit
    if sleep_quality_score >= 50:
        adjustment_reason = "normal"
        adjusted_deficit = deficit
    elif sleep_quality_score >= 30:
        adjustment_reason = "sleep_moderate"
        adjusted_deficit = adjust_deficit_for_sleep(deficit, sleep_quality_score)
    else:
        adjustment_reason = "sleep_severe"
        adjusted_deficit = adjust_deficit_for_sleep(deficit, sleep_quality_score)

    macros = compute_macro_targets(
        tdee=tdee,
        deficit=adjusted_deficit,
        weight_kg=weight_kg,
        training_day_type=training_day_type,
        protein_g_per_kg=protein_g_per_kg,
        fat_g_per_kg=fat_g_per_kg,
        estimated_bf_pct=estimated_bf_pct,
        ffm_kg=ffm_kg,
    )

    return {
        "target_calories": macros["calories"],
        "target_protein": macros["protein"],
        "target_carbs": macros["carbs"],
        "target_fat": macros["fat"],
        "target_fiber": macros["fiber"],
        "tdee_used": tdee,
        "deficit_used": adjusted_deficit,
        "adjustment_reason": adjustment_reason,
        "sleep_quality_score": sleep_quality_score,
        "training_day_type": training_day_type,
        "is_refeed": is_refeed,
    }
