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

def adjust_deficit_for_sleep(
    deficit: float,
    sleep_score: float,
    total_sleep_hours: float | None = None,
) -> dict:
    """Adjust caloric deficit based on sleep quality score (Design doc §9).

    Four tiers:
    - Normal (score >= 70): no change
    - Mild (score 50-69): keep deficit, boost protein +10g / fiber +5g
    - Moderate (score 30-49): halve deficit, boost protein +10g / fiber +5g
    - Severe (score < 30 OR total sleep < 5h): zero deficit (maintenance)
    """
    # <5h sleep → always severe regardless of score
    if total_sleep_hours is not None and total_sleep_hours < 5.0:
        return {"deficit": 0, "reason": "sleep_severe", "protein_boost_g": 0, "fiber_boost_g": 0}

    if sleep_score >= 70:
        return {"deficit": deficit, "reason": "normal", "protein_boost_g": 0, "fiber_boost_g": 0}
    elif sleep_score >= 50:
        # Mild: keep deficit, shift macros toward satiety
        return {"deficit": deficit, "reason": "sleep_mild", "protein_boost_g": 10, "fiber_boost_g": 5}
    elif sleep_score >= 30:
        return {"deficit": deficit / 2, "reason": "sleep_moderate", "protein_boost_g": 10, "fiber_boost_g": 5}
    else:
        return {"deficit": 0, "reason": "sleep_severe", "protein_boost_g": 0, "fiber_boost_g": 0}


def adjust_for_sleep_history(consecutive_poor_nights: int, base_result: dict) -> dict:
    """Multi-day sleep escalation (Design doc §9).

    - 2 poor nights → tier up (mild→moderate, moderate→severe)
    - 3 poor nights → force maintenance
    - 5+ poor nights → recommend diet break
    """
    if consecutive_poor_nights >= 5:
        return {"deficit": 0, "reason": "sleep_diet_break_recommended", "protein_boost_g": 0, "fiber_boost_g": 0}
    elif consecutive_poor_nights >= 3:
        return {"deficit": 0, "reason": "sleep_forced_maintenance", "protein_boost_g": 0, "fiber_boost_g": 0}
    elif consecutive_poor_nights >= 2:
        if base_result["reason"] == "sleep_mild":
            return {"deficit": base_result["deficit"] / 2, "reason": "sleep_moderate_escalated", "protein_boost_g": 10, "fiber_boost_g": 5}
        elif base_result["reason"] == "sleep_moderate":
            return {"deficit": 0, "reason": "sleep_severe_escalated", "protein_boost_g": 0, "fiber_boost_g": 0}
    return base_result


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
    total_sleep_hours: float | None = None,
    consecutive_poor_nights: int = 0,
) -> dict:
    """Generate a complete daily nutrition plan.

    Adjusts the deficit based on sleep quality (4-tier system) and multi-day
    escalation, then delegates to ``compute_macro_targets`` for the actual
    macro computation.

    Returns:
        Dict with target macros plus metadata (tdee_used, deficit_used,
        adjustment_reason, sleep_quality_score, training_day_type, is_refeed,
        protein_boost_g, fiber_boost_g).
    """
    # Sleep adjustments disabled — user prefers consistent deficit regardless of sleep
    adjusted_deficit = deficit
    adjustment_reason = "normal"
    protein_boost = 0
    fiber_boost = 0

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
        "target_protein": macros["protein"] + protein_boost,
        "target_carbs": macros["carbs"],
        "target_fat": macros["fat"],
        "target_fiber": macros["fiber"] + fiber_boost,
        "tdee_used": tdee,
        "deficit_used": adjusted_deficit,
        "adjustment_reason": adjustment_reason,
        "sleep_quality_score": sleep_quality_score,
        "training_day_type": training_day_type,
        "is_refeed": is_refeed,
        "protein_boost_g": protein_boost,
        "fiber_boost_g": fiber_boost,
    }


# ---------------------------------------------------------------------------
# Per-slot kcal pacing
# ---------------------------------------------------------------------------
#
# Scientific invariant: only kcal is softly paced across meal slots. Protein,
# carbs, fat, and fiber have NO scientifically defensible per-slot allocation
# (Schoenfeld & Aragon 2018; Trommelen 2023). Protein is instead signaled by
# the per-meal MPS floor (≥30g per eating event), which is absolute — not a
# proportional share of the day.
#
# The previous SLOT_DISTRIBUTION with per-macro fractions has been deleted.
# If you need to display or compute anything per slot beyond kcal, reconsider.

SLOT_KCAL_DISTRIBUTION = {
    "breakfast": 0.28,
    "lunch":     0.25,
    "dinner":    0.37,
    "pre_sleep": 0.10,
}

ALL_SLOTS = ["breakfast", "lunch", "dinner", "pre_sleep"]


def compute_slot_targets(calories: int) -> dict:
    """Compute per-slot kcal targets from the daily kcal total.

    Returns a mapping {slot: {"calories": int}}. No protein / carbs / fat /
    fiber allocation — those are day-level targets, not per-slot.
    """
    return {slot: {"calories": round(calories * frac)}
            for slot, frac in SLOT_KCAL_DISTRIBUTION.items()}


def redistribute_remaining(daily_kcal_target: int, eaten_kcal_by_slot: dict) -> dict:
    """Redistribute remaining daily kcal across unfilled slots.

    After each meal is logged, remaining kcal is split proportionally among
    the unfilled slots so later meals adapt to earlier eating. Non-kcal
    macros are not split per slot.
    """
    total_eaten = sum(eaten_kcal_by_slot.values())
    filled_slots = set(eaten_kcal_by_slot.keys())
    remaining = max(0, daily_kcal_target - total_eaten)
    unfilled = [s for s in ALL_SLOTS if s not in filled_slots]

    if not unfilled:
        return {s: {"calories": round(eaten_kcal_by_slot.get(s, 0))}
                for s in ALL_SLOTS}

    slot_weights = {s: SLOT_KCAL_DISTRIBUTION[s] for s in unfilled}
    total_weight = sum(slot_weights.values()) or 1.0

    result = {}
    for slot in ALL_SLOTS:
        if slot in filled_slots:
            result[slot] = {"calories": round(eaten_kcal_by_slot[slot])}
        else:
            frac = slot_weights[slot] / total_weight
            result[slot] = {"calories": round(remaining * frac)}
    return result
