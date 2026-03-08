"""
Merge Function — Combines all training engine streams into outputs.

Research: 05-combination-architecture-B.md (Parallel Streams with Merge)

Pace adjustment formula:
    adjusted_pace = base_pace * readiness_factor * fatigue_factor * weight_factor

    readiness_factor = f(readiness_z_score):
        z > +1.0  -> 0.97 (3% faster)
        z = 0     -> 1.00
        z < -1.0  -> 1.05 (5% slower)
        z < -2.0  -> REST (skip workout)

    fatigue_factor = f(TSB):
        TSB > +10  -> 0.98 (fresh -> slightly faster)
        TSB = 0    -> 1.00
        TSB < -20  -> 1.03 (fatigued -> slower)

    weight_factor (pace) = weight_current / weight_at_calibration
"""

# B-goal base pace: 284 sec/km (4:44/km)
DEFAULT_BASE_PACE = 284.0


def readiness_factor(z_score: float) -> float:
    """Map readiness z-score to pace adjustment factor.

    Linear interpolation between anchor points:
    z >= +1.0 -> 0.97  (3% faster)
    z == 0    -> 1.00  (normal)
    z <= -1.0 -> 1.05  (5% slower)
    z <= -2.0 -> -1.0  (REST signal)

    Returns factor (0.97-1.05+), or -1.0 as REST signal.
    """
    if z_score <= -2.0:
        return -1.0  # REST signal
    if z_score >= 1.0:
        return 0.97
    if z_score >= 0.0:
        # Linear: z=0 -> 1.00, z=1 -> 0.97  (slope = -0.03 per unit)
        return 1.00 - 0.03 * z_score
    # z in (-2, 0): two sub-segments
    if z_score >= -1.0:
        # Linear: z=0 -> 1.00, z=-1 -> 1.05  (slope = -0.05 per unit going negative)
        return 1.00 - 0.05 * z_score
    # z in (-2, -1): clamp at 1.05 (already at max slowdown before REST)
    return 1.05


def fatigue_factor(tsb: float) -> float:
    """Map TSB to pace adjustment factor.

    TSB >= +10  -> 0.98 (fresh)
    TSB == 0    -> 1.00
    TSB <= -20  -> 1.03 (fatigued)

    Linear interpolation between anchor points.
    """
    if tsb >= 10.0:
        return 0.98
    if tsb <= -20.0:
        return 1.03
    if tsb >= 0.0:
        # Linear: tsb=0 -> 1.00, tsb=10 -> 0.98  (slope = -0.002 per unit)
        return 1.00 - 0.002 * tsb
    # tsb in (-20, 0): linear from 1.00 to 1.03  (slope = -0.0015 per unit)
    return 1.00 - 0.0015 * tsb


def compute_adjusted_pace(
    base_pace_sec: float,
    readiness_z: float,
    tsb: float,
    weight_factor: float = 1.0,
    slider_factor: float = 1.0,
) -> float | None:
    """
    Compute adjusted pace from all factors.

    Args:
        base_pace_sec: base pace in sec/km (e.g. 284 = 4:44/km)
        readiness_z: readiness composite z-score
        tsb: training stress balance from PMC
        weight_factor: weight_calibration / weight_current (default 1.0)
        slider_factor: user preference slider (1.0 = normal, >1.0 = amplify
            improvement delta, <1.0 = dampen it)

    Returns adjusted pace in sec/km, or None if REST is indicated.
    """
    rf = readiness_factor(readiness_z)
    if rf < 0:
        return None  # REST
    ff = fatigue_factor(tsb)
    # Combined adjustment before slider
    combined = rf * ff * weight_factor
    # Slider scales the delta from 1.0 (neutral)
    delta = combined - 1.0
    adjusted = 1.0 + delta * slider_factor
    return base_pace_sec * adjusted


def merge(load: dict, readiness: dict, fitness: dict, body_comp: dict,
          slider_factor: float = 1.0) -> dict:
    """
    Merge all stream outputs into actionable results.

    Args:
        load: {"ctl": float, "atl": float, "tsb": float}
        readiness: {"composite_score": float, "traffic_light": str}
        fitness: {"vo2max": float, "decoupling_pct": float}
        body_comp: {"weight_ema": float, "vdot_adjusted": float}

    Returns: {
        "adjusted_pace": float | None,  # sec/km, None = REST
        "readiness_factor": float,
        "fatigue_factor": float,
        "traffic_light": str,
        "vo2max": float,
        "vdot_adjusted": float,
        "weight_ema": float,
        "tsb": float,
        "fitness_trajectory": dict,  # summary of fitness indicators
    }
    """
    tsb = load.get("tsb", 0.0)
    composite_score = readiness.get("composite_score", 0.0)
    traffic_light = readiness.get("traffic_light", "green")

    vo2max = fitness.get("vo2max")
    decoupling_pct = fitness.get("decoupling_pct")

    weight_ema = body_comp.get("weight_ema")
    vdot_adjusted = body_comp.get("vdot_adjusted")

    # Compute weight factor for pace: current_weight / calibration_weight
    # Heavier → factor > 1 → slower pace. Lighter → factor < 1 → faster pace.
    calibration_weight = body_comp.get("calibration_weight_kg")
    weight_factor_value = 1.0
    if calibration_weight and weight_ema and calibration_weight > 0:
        weight_factor_value = weight_ema / calibration_weight

    # Compute pace factors
    rf = readiness_factor(composite_score)
    ff = fatigue_factor(tsb)

    # Compute adjusted pace WITH weight factor and slider
    adjusted_pace = compute_adjusted_pace(
        DEFAULT_BASE_PACE,
        readiness_z=composite_score,
        tsb=tsb,
        weight_factor=weight_factor_value,
        slider_factor=slider_factor,
    )

    return {
        "adjusted_pace": round(adjusted_pace, 1) if adjusted_pace is not None else None,
        "readiness_factor": round(rf, 4),
        "fatigue_factor": round(ff, 4),
        "weight_factor": round(weight_factor_value, 4),
        "slider_factor": slider_factor,
        "traffic_light": traffic_light,
        "vo2max": vo2max,
        "vdot_adjusted": vdot_adjusted,
        "weight_ema": weight_ema,
        "tsb": tsb,
        "fitness_trajectory": {
            "ctl": load.get("ctl"),
            "atl": load.get("atl"),
            "decoupling_pct": decoupling_pct,
            "aerobic_base": (
                "excellent" if decoupling_pct is not None and decoupling_pct < 3.0
                else "adequate" if decoupling_pct is not None and decoupling_pct < 5.0
                else "developing" if decoupling_pct is not None
                else None
            ),
        },
    }
