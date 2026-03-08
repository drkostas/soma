"""Plan Adapter — Adapts daily workout targets based on readiness + fatigue.

Rules (from design doc):
  RED + hard    -> rest or easy 4km
  RED + easy    -> reduce to 4km max
  YELLOW + hard -> swap to easy, reduce distance ~85%
  YELLOW + easy -> as planned
  GREEN         -> as planned, minor distance adjustment if TSB very negative

Distance adjustment for non-RED/YELLOW:
  TSB < -15: reduce 10%
  TSB < -20: reduce 15%
"""

HARD_RUN_TYPES = {"tempo", "intervals", "threshold"}


def adapt_workout(
    run_type: str,
    target_distance_km: float,
    traffic_light: str,
    composite_z: float,
    tsb: float,
) -> dict:
    """Adapt a single workout based on readiness and fatigue signals.

    Returns: {
        "run_type": str,
        "distance_km": float,
        "pace_factor": float,
        "action": str,
        "reason": str,
    }
    """
    is_hard = run_type in HARD_RUN_TYPES
    is_rest = run_type == "rest"

    if is_rest:
        return {
            "run_type": "rest",
            "distance_km": 0.0,
            "pace_factor": 1.0,
            "action": "as_planned",
            "reason": "Rest day",
        }

    if traffic_light == "red":
        if is_hard:
            return {
                "run_type": "easy",
                "distance_km": 4.0,
                "pace_factor": 1.10,
                "action": "downgrade_to_rest",
                "reason": "RED readiness — hard session replaced with easy 4km",
            }
        return {
            "run_type": run_type,
            "distance_km": min(target_distance_km, 4.0),
            "pace_factor": 1.10,
            "action": "reduce",
            "reason": "RED readiness — distance capped at 4km",
        }

    if traffic_light == "yellow":
        if is_hard:
            return {
                "run_type": "easy",
                "distance_km": round(target_distance_km * 0.85, 1),
                "pace_factor": 1.05,
                "action": "swap_to_easy",
                "reason": "YELLOW readiness — hard session swapped to easy",
            }
        return {
            "run_type": run_type,
            "distance_km": target_distance_km,
            "pace_factor": 1.0,
            "action": "as_planned",
            "reason": "YELLOW readiness — easy run OK as planned",
        }

    # GREEN
    distance = target_distance_km
    pace_factor = 1.0

    if tsb < -20:
        distance = round(target_distance_km * 0.85, 1)
        pace_factor = 1.03
    elif tsb < -15:
        distance = round(target_distance_km * 0.90, 1)
        pace_factor = 1.02

    action = "as_planned" if distance == target_distance_km else "reduce"
    reason = (
        "As planned"
        if action == "as_planned"
        else f"TSB={tsb:.0f} — distance reduced {round((1-distance/target_distance_km)*100)}%"
    )

    return {
        "run_type": run_type,
        "distance_km": distance,
        "pace_factor": pace_factor,
        "action": action,
        "reason": reason,
    }
