"""TDEE bootstrap and macro target computation — Tasks 4 & 7.

Provides functions to estimate Total Daily Energy Expenditure from Garmin
data and compute per-day macronutrient targets based on training day type,
deficit goals, and RED-S safety floors.

Task 7 adds HR-zone-based exercise calorie computation using the Keytel
formula, replacing the static TRAINING_CALORIE_BOOST dict.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# HR zone midpoints (bpm) — standard Garmin 5-zone model
HR_ZONE_MIDPOINTS: dict[int, int] = {1: 115, 2: 140, 3: 158, 4: 172, 5: 183}

# Gym calorie estimation
GYM_KCAL_PER_MIN: float = 6
GYM_EPOC_FRACTION: float = 0.10

# EPOC multiplier by HR zone
EPOC_BY_ZONE: dict[int, float] = {1: 0.02, 2: 0.05, 3: 0.08, 4: 0.12, 5: 0.15}

# Default pace (sec/km) by HR zone when no pace targets are available
_DEFAULT_PACE_BY_ZONE: dict[int, float] = {
    1: 420,  # ~7:00 /km — easy jog / walk
    2: 360,  # ~6:00 /km — easy run
    3: 320,  # ~5:20 /km — tempo
    4: 280,  # ~4:40 /km — threshold
    5: 250,  # ~4:10 /km — VO2max
}

# Step calorie estimation
STEP_KCAL_PER_STEP_PER_KG: float = 0.000423  # conservative: ~-50 kcal/day vs Garmin

CARB_TARGETS_G_PER_KG: dict[str, float] = {
    "rest": 3.0,
    "easy_run": 3.5,
    "hard_run": 4.25,
    "long_run": 4.75,
    "gym": 3.5,
    "gym_and_run": 4.0,
}

MAX_DEFICIT: int = 1200  # Safety cap — profile can set up to 1200, above risks metabolic adaptation
REDS_FLOOR: int = 25  # kcal per kg FFM

# Energy density of body fat (kcal per kg)
KCAL_PER_KG_FAT: float = 7700


# ---------------------------------------------------------------------------
# Goal-based deficit computation (Task 9)
# ---------------------------------------------------------------------------

def compute_deficit_from_goal(
    weight_kg: float,
    current_bf_pct: float,
    target_bf_pct: float,
    target_date,  # date object
    today=None,   # date object
) -> dict:
    """Compute daily caloric deficit needed to reach a body-fat % goal.

    Uses a constant fat-free mass (FFM) assumption: only fat mass changes.
    Caps the deficit at :data:`MAX_DEFICIT` (1200 kcal/day) and assigns a
    traffic-light safety rating based on weekly weight-loss rate.

    Args:
        weight_kg: Current body weight in kg.
        current_bf_pct: Current body-fat percentage (e.g. 17 for 17%).
        target_bf_pct: Target body-fat percentage (e.g. 12 for 12%).
        target_date: Date by which to reach the goal.
        today: Reference date (defaults to ``date.today()``).

    Returns:
        Dict with keys:
        - ``daily_deficit``: Capped daily kcal deficit (0-500).
        - ``fat_to_lose_kg``: Fat mass to lose (kg).
        - ``timeline_weeks``: Weeks until target_date.
        - ``weekly_rate_pct``: Projected weekly weight-loss as % of body weight.
        - ``safety``: Traffic-light rating (``"green"``, ``"yellow"``, ``"red"``).
    """
    from config import today_nyc

    if today is None:
        today = today_nyc()

    # Fat-free mass stays constant; only fat mass changes
    ffm_kg = weight_kg * (1 - current_bf_pct / 100)
    target_weight = ffm_kg / (1 - target_bf_pct / 100)
    fat_to_lose = weight_kg - target_weight

    if fat_to_lose <= 0:
        return {
            "daily_deficit": 0,
            "fat_to_lose_kg": 0,
            "timeline_weeks": 0,
            "weekly_rate_pct": 0,
            "safety": "green",
        }

    available_days = max((target_date - today).days, 1)
    available_weeks = available_days / 7

    raw_deficit = (fat_to_lose * KCAL_PER_KG_FAT) / available_days
    weekly_rate_pct = (fat_to_lose / available_weeks) / weight_kg * 100

    if raw_deficit > 500 or weekly_rate_pct > 1.0:
        safety = "red"
    elif raw_deficit > 400 or weekly_rate_pct > 0.7:
        safety = "yellow"
    else:
        safety = "green"

    capped_deficit = min(raw_deficit, MAX_DEFICIT)

    return {
        "daily_deficit": round(capped_deficit),
        "fat_to_lose_kg": round(fat_to_lose, 1),
        "timeline_weeks": round(available_weeks, 1),
        "weekly_rate_pct": round(weekly_rate_pct, 2),
        "safety": safety,
    }


# ---------------------------------------------------------------------------
# Step calorie helpers (Task 8)
# ---------------------------------------------------------------------------

def compute_step_calories(step_goal: int, weight_kg: float) -> float:
    """Compute NEAT calories from expected daily steps.

    Uses step_goal (not actual steps) since this is for planning.

    Formula: step_goal × 0.0005 × weight_kg
    e.g. 10 000 steps × 0.0005 × 80 kg = 400 kcal

    Args:
        step_goal: Daily step target (non-negative).
        weight_kg: Body weight in kg.

    Returns:
        Estimated NEAT calories from walking/steps, rounded to 1 decimal.
    """
    if step_goal <= 0:
        return 0.0
    return round(step_goal * STEP_KCAL_PER_STEP_PER_KG * weight_kg, 1)


# ---------------------------------------------------------------------------
# HR-zone calorie helpers (Task 7)
# ---------------------------------------------------------------------------

def _keytel_kcal_per_min(
    hr: float, weight_kg: float, age: int, sex: str,
) -> float:
    """Keytel et al. (2005) energy expenditure formula.

    Returns estimated kcal burned per minute at a given heart rate.

    Args:
        hr: Heart rate in bpm.
        weight_kg: Body weight in kg.
        age: Age in years.
        sex: ``"male"`` or ``"female"``; anything else defaults to male.
    """
    if sex == "female":
        return (-20.4022 + 0.4472 * hr - 0.1263 * weight_kg + 0.074 * age) / 4.184
    # Male (default)
    return (-55.0969 + 0.6309 * hr + 0.1988 * weight_kg + 0.2017 * age) / 4.184


def _estimate_step_duration_min(step: dict) -> float:
    """Estimate the duration (minutes) of a single workout step.

    Handles three duration types:
    - ``time``: duration_value is seconds → convert to minutes.
    - ``distance``: duration_value is meters → estimate from pace targets
      (average of target_pace_min/max in sec/km) or from HR-zone default pace.
    - ``lap_button`` or value == 0: returns 0.
    """
    dtype = step.get("duration_type", "")
    value = step.get("duration_value", 0) or 0

    if value == 0 or dtype == "lap_button":
        return 0.0

    if dtype == "time":
        return value / 60.0

    if dtype == "distance":
        # distance in meters
        dist_km = value / 1000.0

        pace_min = step.get("target_pace_min")
        pace_max = step.get("target_pace_max")

        if pace_min and pace_max:
            avg_pace_sec_per_km = (pace_min + pace_max) / 2.0
        elif pace_min:
            avg_pace_sec_per_km = pace_min
        elif pace_max:
            avg_pace_sec_per_km = pace_max
        else:
            # Fall back to HR-zone default pace
            zone = step.get("hr_zone", 2)
            avg_pace_sec_per_km = _DEFAULT_PACE_BY_ZONE.get(zone, 360)

        return dist_km * avg_pace_sec_per_km / 60.0

    # Unknown duration type
    return 0.0


def estimate_step_calories(
    step: dict,
    weight_kg: float,
    age: int,
    sex: str,
) -> float:
    """Compute calories for a single workout step using Keytel + EPOC.

    Args:
        step: Workout step dict with hr_zone, duration_type, duration_value, etc.
        weight_kg: Body weight in kg.
        age: Age in years.
        sex: ``"male"`` or ``"female"``.

    Returns:
        Estimated calories (kcal) for this step.
    """
    duration_min = _estimate_step_duration_min(step)
    if duration_min <= 0:
        return 0.0

    zone = step.get("hr_zone", 2)
    hr = HR_ZONE_MIDPOINTS.get(zone, 140)

    base_per_min = _keytel_kcal_per_min(hr, weight_kg, age, sex)
    epoc_mult = 1.0 + EPOC_BY_ZONE.get(zone, 0.05)

    return base_per_min * duration_min * epoc_mult


def compute_exercise_calories(
    workout_steps: list[dict] | None,
    weight_kg: float,
    age: int,
    sex: str,
    has_gym: bool = False,
    gym_duration_min: float = 60,
    run_distance_km: float = 0,
) -> float:
    """Sum calories across all workout steps + optional gym session.

    Args:
        workout_steps: List of step dicts from training_plan_day.workout_steps.
            ``None`` or empty list → 0 run calories.
        weight_kg: Body weight in kg.
        age: Age in years.
        sex: ``"male"`` or ``"female"``.
        has_gym: Whether the day includes a gym session.
        gym_duration_min: Duration of gym session in minutes (default 60).
        run_distance_km: Planned run distance in km. Used as fallback when
            workout_steps is empty/None (e.g. easy/rest run days).

    Returns:
        Total estimated exercise calories (kcal).
    """
    total = 0.0

    if workout_steps:
        for step in workout_steps:
            total += estimate_step_calories(step, weight_kg, age, sex)

    # Distance-based fallback when no structured workout_steps
    if total == 0 and run_distance_km > 0:
        # ~1 kcal/kg/km is the standard running energy cost (ACSM)
        total = run_distance_km * 1.0 * weight_kg

    if has_gym:
        total += gym_duration_min * GYM_KCAL_PER_MIN * (1 + GYM_EPOC_FRACTION)

    return total


# ---------------------------------------------------------------------------
# Core functions
# ---------------------------------------------------------------------------

def bootstrap_tdee(bmr: float, active_kcal: float) -> float:
    """Estimate TDEE from BMR and Garmin active calories.

    Formula: TDEE = BMR + active_kcal * 0.75

    The 0.75 multiplier accounts for Garmin's tendency to overestimate
    active calorie burn.

    .. deprecated::
        Use :func:`bootstrap_tdee_base` instead. Step and exercise
        calories are now added separately at the daily plan level.
    """
    return bmr + active_kcal * 0.75


def bootstrap_tdee_base(bmr: float) -> float:
    """Return base TDEE = BMR.

    Step calories and exercise calories are added separately at the
    daily plan level (Tasks 8 & 7 respectively).
    """
    return bmr


def compute_macro_targets(
    tdee: float,
    deficit: float,
    weight_kg: float,
    exercise_calories: float = 0,
    training_day_type: str = "rest",
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
        exercise_calories: Estimated exercise calories from
            :func:`compute_exercise_calories` (replaces static boost).
        training_day_type: Day type key for carb periodization (Task 10).
        protein_g_per_kg: Protein target per kg body weight (default 2.2).
        fat_g_per_kg: Fat target per kg body weight (default 0.8).
        estimated_bf_pct: Optional body fat percentage (unused currently).
        ffm_kg: Optional fat-free mass in kg for RED-S floor check.

    Returns:
        Dict with ``calories``, ``protein``, ``carbs``, ``fat``, ``fiber``.
    """
    # 1. Cap deficit at MAX_DEFICIT
    deficit = min(deficit, MAX_DEFICIT)

    # 2. Target calories = TDEE + exercise calories - deficit
    target_calories = int(tdee + exercise_calories - deficit)

    # 3. RED-S floor check
    if ffm_kg is not None:
        reds_minimum = int(REDS_FLOOR * ffm_kg)
        if target_calories < reds_minimum:
            target_calories = reds_minimum

    # 4. Protein
    protein = round(weight_kg * protein_g_per_kg)

    # 5. Fat
    fat = round(weight_kg * fat_g_per_kg)

    # 6. Carbs = strict remainder after protein and fat (guarantees macro-calorie match)
    carb_remainder = max((target_calories - (protein * 4) - (fat * 9)) / 4, 0)
    carbs = round(carb_remainder)

    # 7. Fiber (fixed)
    fiber = 35

    return {
        "calories": target_calories,
        "protein": protein,
        "carbs": carbs,
        "fat": fat,
        "fiber": fiber,
    }
