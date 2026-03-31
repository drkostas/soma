"""
Strength Load Estimation — Estimate training load from strength workouts.

Research: 04-strength-load-no-rpe-B2.md

Uses Tier 1 (Estimated sRPE from %1RM + RIR) as the primary method:
- Epley formula: 1RM = weight * (1 + reps/30)
- Zourdos 2016 RIR-RPE scale: RPE = 10 - RIR
- RIR estimated via inverted Epley: max_reps = 30 * (1RM/weight - 1)
- Session load = session_RPE * duration_min
- Running relevance factors for cross-modal load scaling

Cross-modal integration:
  daily_load = running_load + strength_load * CROSS_MODAL_SCALE
  where CROSS_MODAL_SCALE = 0.5 (recommended starting value from research)
"""

# Running relevance factors: how much each exercise affects running performance.
# Compound lower body = 1.0, accessory lower = 0.8, core = 0.5, upper = 0.1-0.3.
RUNNING_RELEVANCE = {
    # Lower body compounds — full relevance
    "squat": 1.0,
    "barbell squat": 1.0,
    "back squat": 1.0,
    "front squat": 1.0,
    "deadlift": 1.0,
    "romanian deadlift": 1.0,
    "rdl": 1.0,
    "leg press": 1.0,
    "lunge": 1.0,
    "walking lunge": 1.0,
    "bulgarian split squat": 1.0,
    # Lower body accessory
    "leg curl": 0.8,
    "leg extension": 0.8,
    "calf raise": 0.8,
    "hip thrust": 0.8,
    "glute bridge": 0.8,
    # Core — moderate relevance
    "plank": 0.5,
    "ab wheel": 0.5,
    "hanging leg raise": 0.5,
    "cable crunch": 0.5,
    "crunch": 0.5,
    "leg raise": 0.5,
    # Upper body — low relevance
    "bench press": 0.2,
    "overhead press": 0.2,
    "incline bench press": 0.2,
    "pull up": 0.3,
    "chin up": 0.3,
    "chest dip": 0.3,
    "barbell row": 0.3,
    "dumbbell row": 0.3,
    "lat pulldown": 0.2,
    "chest fly": 0.2,
    "bicep curl": 0.1,
    "hammer curl": 0.1,
    "preacher curl": 0.1,
    "tricep extension": 0.1,
    "triceps pushdown": 0.1,
    "lateral raise": 0.1,
}

# Strength load scaled by 0.5 when adding to running PMC (research Section 14.2)
CROSS_MODAL_SCALE = 0.5


def estimate_1rm(weight_kg: float, reps: int) -> float:
    """Epley formula: 1RM = weight * (1 + reps/30).

    For 1 rep, returns the weight itself (the formula converges to weight at 1 rep).
    Returns 0.0 for zero/negative inputs.

    Accuracy: <5% error for reps 1-10, acceptable for 10-15,
    increasingly inaccurate above 15 reps (Ware et al.).
    """
    if reps <= 0 or weight_kg <= 0:
        return 0.0
    if reps == 1:
        return weight_kg
    return weight_kg * (1 + reps / 30)


def estimate_rpe(weight_kg: float, reps: int, estimated_1rm: float) -> float:
    """Estimate RPE from %1RM and reps using the Zourdos 2016 RIR-RPE approach.

    Method (from research Section 7.3 / 13 Tier 1):
      1. %1RM = weight_kg / estimated_1rm
      2. max_reps = 30 * (1RM/weight - 1)  [Epley inverted]
      3. RIR = max(0, max_reps - actual_reps)
      4. RPE = 10 - RIR, clamped to [1.0, 10.0]

    Returns RPE on the CR-10 scale.
    """
    if estimated_1rm <= 0:
        return 5.0  # fallback for missing 1RM data
    pct = weight_kg / estimated_1rm
    if pct >= 1.0:
        return 10.0
    # Invert Epley: max possible reps at this weight
    max_reps = 30 * (1 / pct - 1)
    rir = max(0, max_reps - reps)
    rpe = 10 - rir
    return max(1.0, min(10.0, round(rpe, 1)))


def get_running_relevance(exercise_name: str) -> float:
    """Get running relevance factor for an exercise (0.0-1.0).

    Matches against the RUNNING_RELEVANCE table using case-insensitive
    lookup with partial matching for exercise names that include
    equipment suffixes (e.g. "Squat (Barbell)" matches "squat").

    Returns 0.3 for unknown exercises (moderate default).
    """
    name_lower = exercise_name.lower().strip()
    # Direct match
    if name_lower in RUNNING_RELEVANCE:
        return RUNNING_RELEVANCE[name_lower]
    # Partial match — check if any key is contained in the name or vice versa
    for key, val in RUNNING_RELEVANCE.items():
        if key in name_lower or name_lower in key:
            return val
    return 0.3  # default for unknown exercises


def compute_strength_load(exercises: list[dict], duration_min: float) -> dict:
    """Compute session load for a strength workout.

    Uses Tier 1 method from research: estimated sRPE * duration.

    For each exercise, estimates 1RM from the best set (highest Epley e1RM),
    then computes per-set RPE via the RIR-RPE approach. Session RPE is the
    volume-weighted average across all working sets.

    Args:
        exercises: List of exercise dicts, each with:
            - "name": str (exercise name)
            - "sets": list of {"weight_kg": float, "reps": int}
        duration_min: total session duration in minutes

    Returns:
        {
            "load_value": float,          # sRPE * duration_min
            "session_rpe": float,         # volume-weighted average RPE
            "running_relevance": float,   # volume-weighted average relevance
            "cross_modal_load": float,    # load * running_relevance * CROSS_MODAL_SCALE
        }
    """
    if not exercises or duration_min <= 0:
        return {
            "load_value": 0.0,
            "session_rpe": 0.0,
            "running_relevance": 0.0,
            "cross_modal_load": 0.0,
        }

    total_vl = 0.0       # sum of weight * reps across all sets (for weighting)
    weighted_rpe = 0.0    # sum of (set_rpe * set_vl)
    weighted_rel = 0.0    # sum of (relevance * set_vl)

    for exercise in exercises:
        name = exercise.get("name", "")
        sets = exercise.get("sets", [])
        if not sets:
            continue

        relevance = get_running_relevance(name)

        # Step 1: Estimate 1RM from the best set for this exercise
        best_1rm = 0.0
        for s in sets:
            w = s.get("weight_kg", 0)
            r = s.get("reps", 0)
            e1rm = estimate_1rm(w, r)
            if e1rm > best_1rm:
                best_1rm = e1rm

        # Step 2: Compute per-set RPE and accumulate weighted sums
        for s in sets:
            w = s.get("weight_kg", 0)
            r = s.get("reps", 0)
            if w <= 0 or r <= 0:
                continue

            set_vl = w * r
            set_rpe = estimate_rpe(w, r, best_1rm)

            total_vl += set_vl
            weighted_rpe += set_rpe * set_vl
            weighted_rel += relevance * set_vl

    if total_vl <= 0:
        return {
            "load_value": 0.0,
            "session_rpe": 0.0,
            "running_relevance": 0.0,
            "cross_modal_load": 0.0,
        }

    session_rpe = weighted_rpe / total_vl
    running_relevance = weighted_rel / total_vl

    # Session load = sRPE * duration (Foster et al., 2001)
    load_value = session_rpe * duration_min

    # Cross-modal load for PMC integration
    cross_modal_load = load_value * running_relevance * CROSS_MODAL_SCALE

    return {
        "load_value": round(load_value, 2),
        "session_rpe": round(session_rpe, 2),
        "running_relevance": round(running_relevance, 4),
        "cross_modal_load": round(cross_modal_load, 2),
    }
