"""TDEE bootstrap and macro target computation — Task 4.

Provides functions to estimate Total Daily Energy Expenditure from Garmin
data and compute per-day macronutrient targets based on training day type,
deficit goals, and RED-S safety floors.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

TRAINING_CALORIE_BOOST: dict[str, int] = {
    "rest": 0,
    "easy_run": 275,
    "hard_run": 500,
    "long_run": 650,
    "gym": 275,
    "gym_and_run": 600,
}

CARB_TARGETS_G_PER_KG: dict[str, float] = {
    "rest": 3.0,
    "easy_run": 3.5,
    "hard_run": 4.25,
    "long_run": 4.75,
    "gym": 3.5,
    "gym_and_run": 4.0,
}

MAX_DEFICIT: int = 500
REDS_FLOOR: int = 25  # kcal per kg FFM


# ---------------------------------------------------------------------------
# Functions
# ---------------------------------------------------------------------------

def bootstrap_tdee(bmr: float, active_kcal: float) -> float:
    """Estimate TDEE from BMR and Garmin active calories.

    Formula: TDEE = BMR + active_kcal * 0.75

    The 0.75 multiplier accounts for Garmin's tendency to overestimate
    active calorie burn.
    """
    return bmr + active_kcal * 0.75


def compute_macro_targets(
    tdee: float,
    deficit: float,
    weight_kg: float,
    training_day_type: str,
    protein_g_per_kg: float = 2.2,
    fat_g_per_kg: float = 0.8,
    estimated_bf_pct: float | None = None,
    ffm_kg: float | None = None,
) -> dict[str, int]:
    """Compute daily macro targets given TDEE, deficit, and training context.

    Args:
        tdee: Total daily energy expenditure in kcal.
        deficit: Desired caloric deficit in kcal (capped at MAX_DEFICIT).
        weight_kg: Current body weight in kg.
        training_day_type: One of the keys in TRAINING_CALORIE_BOOST.
        protein_g_per_kg: Protein target per kg body weight (default 2.2).
        fat_g_per_kg: Fat target per kg body weight (default 0.8).
        estimated_bf_pct: Optional body fat percentage (unused currently).
        ffm_kg: Optional fat-free mass in kg for RED-S floor check.

    Returns:
        Dict with ``calories``, ``protein``, ``carbs``, ``fat``, ``fiber``.
    """
    # 1. Cap deficit at MAX_DEFICIT
    deficit = min(deficit, MAX_DEFICIT)

    # 2. Training calorie boost
    boost = TRAINING_CALORIE_BOOST.get(training_day_type, 0)

    # 3. Target calories
    target_calories = int(tdee - deficit + boost)

    # 4. RED-S floor check
    if ffm_kg is not None:
        reds_minimum = int(REDS_FLOOR * ffm_kg)
        if target_calories < reds_minimum:
            target_calories = reds_minimum

    # 5. Protein
    protein = round(weight_kg * protein_g_per_kg)

    # 6. Fat
    fat = round(weight_kg * fat_g_per_kg)

    # 7. Carbs = remainder
    carbs_kcal = target_calories - (protein * 4) - (fat * 9)
    carbs = max(0, round(carbs_kcal / 4))

    # 8. Fiber (fixed)
    fiber = 35

    return {
        "calories": target_calories,
        "protein": protein,
        "carbs": carbs,
        "fat": fat,
        "fiber": fiber,
    }
