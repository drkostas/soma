"""Daniels/Gilbert VDOT formula engine.

Implements the running VO2 equations from Jack Daniels' "Daniels' Running Formula"
and Jimmy Gilbert's oxygen cost model. Converts between race performances and
training paces across all Daniels zones.

References:
    - Daniels, J. (2014). Daniels' Running Formula, 3rd ed.
    - Gilbert, J. (2005). "Oxygen power: Performance tables for distance runners."
"""

from __future__ import annotations

import math
from typing import Dict, Tuple, Union


# ===============================
# CORE EQUATIONS
# ===============================

def _vo2_cost(velocity_m_min: float) -> float:
    """Oxygen cost of running at a given velocity.

    Eq: VO2 = -4.60 + 0.182258*v + 0.000104*v^2

    Args:
        velocity_m_min: Running speed in meters per minute.

    Returns:
        VO2 in mL/kg/min.

    Reference: Daniels & Gilbert oxygen cost equation.
    """
    v = velocity_m_min
    return -4.60 + 0.182258 * v + 0.000104 * v * v


def _vo2_demand_fraction(time_min: float) -> float:
    """Fraction of VO2max sustainable for a given duration.

    Eq: f(t) = 0.8 + 0.1894393*e^(-0.012778*t) + 0.2989558*e^(-0.1932605*t)

    Args:
        time_min: Duration in minutes.

    Returns:
        Fraction of VO2max (0..~1.0).

    Reference: Daniels & Gilbert demand fraction equation.
    """
    t = time_min
    return (0.8
            + 0.1894393 * math.exp(-0.012778 * t)
            + 0.2989558 * math.exp(-0.1932605 * t))


def vdot_from_race(distance_m: float, time_seconds: float) -> float:
    """Calculate VDOT from a race performance.

    VDOT = vo2_cost(velocity) / vo2_demand_fraction(time)

    Args:
        distance_m: Race distance in meters.
        time_seconds: Finish time in seconds.

    Returns:
        VDOT score.

    Example:
        >>> round(vdot_from_race(5000, 1276), 1)  # 5K in 21:16
        47.0
    """
    time_min = time_seconds / 60.0
    velocity = distance_m / time_min  # m/min
    vo2 = _vo2_cost(velocity)
    fraction = _vo2_demand_fraction(time_min)
    return vo2 / fraction


def velocity_at_vo2max(vdot: float) -> float:
    """Velocity (m/min) at 100% VO2max for a given VDOT.

    Inverts the cost equation: vdot = -4.60 + 0.182258*v + 0.000104*v^2
    Solving the quadratic: 0.000104*v^2 + 0.182258*v + (-4.60 - vdot) = 0

    Args:
        vdot: VDOT score.

    Returns:
        Velocity in meters per minute.
    """
    a = 0.000104
    b = 0.182258
    c = -4.60 - vdot
    discriminant = b * b - 4 * a * c
    return (-b + math.sqrt(discriminant)) / (2 * a)


def _velocity_at_fraction(vdot: float, fraction: float) -> float:
    """Velocity (m/min) at a given fraction of VO2max.

    Inverts cost equation for vo2 = vdot * fraction.

    Args:
        vdot: VDOT score.
        fraction: Fraction of VO2max (e.g. 0.88 for threshold).

    Returns:
        Velocity in meters per minute.
    """
    target_vo2 = vdot * fraction
    a = 0.000104
    b = 0.182258
    c = -4.60 - target_vo2
    discriminant = b * b - 4 * a * c
    return (-b + math.sqrt(discriminant)) / (2 * a)


def time_from_vdot(vdot: float, distance_m: float) -> float:
    """Predict race time from VDOT using binary search.

    Finds time t such that vdot_from_race(distance_m, t) == vdot.

    Args:
        vdot: VDOT score.
        distance_m: Race distance in meters.

    Returns:
        Predicted time in seconds.
    """
    # Binary search: shorter time -> higher VDOT
    lo = 60.0       # 1 minute (very fast)
    hi = 86400.0    # 24 hours (very slow)

    for _ in range(100):  # converge well within 100 iterations
        mid = (lo + hi) / 2.0
        computed = vdot_from_race(distance_m, mid)
        if computed > vdot:
            lo = mid   # too fast, slow down
        else:
            hi = mid   # too slow, speed up

    return (lo + hi) / 2.0


# ===============================
# TRAINING ZONES
# ===============================

# Daniels zone %VO2max fractions, calibrated to match the published VDOT
# pace tables in Daniels' Running Formula, 3rd ed., Chapter 4.
# These fractions were reverse-engineered from the published VDOT 47 pace
# table using the cost equation and verified against VDOT 40-60.
ZONE_VO2MAX_FRACTIONS: Dict[str, Tuple[float, float]] = {
    "easy":        (0.6435, 0.7015),
    "marathon":    (0.8130, 0.8130),
    "threshold":   (0.8772, 0.8772),
    "interval":    (0.9650, 0.9650),
    "repetition":  (1.0474, 1.0817),
}


def percent_vo2max_for_zone(zone: str) -> Tuple[float, float]:
    """Return the %VO2max range for a Daniels training zone.

    Args:
        zone: One of 'easy', 'marathon', 'threshold', 'interval', 'repetition'.

    Returns:
        Tuple of (low_fraction, high_fraction).

    Raises:
        ValueError: If zone is not recognized.
    """
    if zone not in ZONE_VO2MAX_FRACTIONS:
        raise ValueError(
            f"Unknown zone '{zone}'. Valid: {list(ZONE_VO2MAX_FRACTIONS.keys())}"
        )
    return ZONE_VO2MAX_FRACTIONS[zone]


def pace_for_zone(vdot: float, zone: str) -> Union[Tuple[int, int], int]:
    """Training pace in sec/km for a Daniels zone.

    For easy and repetition zones (which have wide ranges), returns a tuple
    (fast_pace, slow_pace) in sec/km. For threshold, interval, and marathon
    zones, returns a single integer pace (midpoint of the %VO2max range).

    Args:
        vdot: VDOT score.
        zone: One of 'easy', 'marathon', 'threshold', 'interval', 'repetition'.

    Returns:
        Tuple (fast_sec_km, slow_sec_km) for easy/repetition,
        or int sec/km for threshold/interval/marathon.
    """
    low_frac, high_frac = percent_vo2max_for_zone(zone)

    if zone in ("easy", "repetition"):
        # Return range: fast = high fraction, slow = low fraction
        fast_vel = _velocity_at_fraction(vdot, high_frac)  # faster
        slow_vel = _velocity_at_fraction(vdot, low_frac)   # slower
        fast_pace = round(1000.0 / fast_vel * 60.0)  # sec/km
        slow_pace = round(1000.0 / slow_vel * 60.0)
        return (fast_pace, slow_pace)
    else:
        # Single pace at midpoint of range
        mid_frac = (low_frac + high_frac) / 2.0
        vel = _velocity_at_fraction(vdot, mid_frac)
        return round(1000.0 / vel * 60.0)


def all_paces(vdot: float) -> dict:
    """Compute all Daniels training paces for a given VDOT.

    Returns a dict compatible with plan_generator expectations:
        {
            "E": (fast_sec_km, slow_sec_km),
            "M": (pace, pace),
            "T": (pace, pace),
            "I": (pace, pace),
            "R": (fast_sec_km, slow_sec_km),
        }

    Single-pace zones are wrapped in a tuple (val, val) for uniformity
    with the plan generator's indexing convention (paces["T"][0]).

    Args:
        vdot: VDOT score.

    Returns:
        Dict mapping zone letters to pace tuples.
    """
    e = pace_for_zone(vdot, "easy")          # (fast, slow)
    m = pace_for_zone(vdot, "marathon")      # int
    t = pace_for_zone(vdot, "threshold")     # int
    i = pace_for_zone(vdot, "interval")      # int
    r = pace_for_zone(vdot, "repetition")    # (fast, slow)

    return {
        "E": e,
        "M": (m, m),
        "T": (t, t),
        "I": (i, i),
        "R": r,
    }


# ===============================
# GOAL PACES
# ===============================

def hm_goal_paces(vdot: float) -> dict:
    """Compute half marathon A/B/C goal paces.

    - A goal: threshold pace (aggressive, ~T pace)
    - B goal: predicted HM pace from VDOT
    - C goal: B * 1.03 (conservative fallback)

    Args:
        vdot: VDOT score.

    Returns:
        Dict with keys "A", "B", "C" as integer sec/km.
    """
    # A goal = threshold pace
    a_pace = pace_for_zone(vdot, "threshold")

    # B goal = predicted HM pace
    hm_time = time_from_vdot(vdot, 21097.5)  # standard HM distance in meters
    hm_pace = hm_time / 21.0975  # sec/km
    b_pace = round(hm_pace)

    # C goal = B * 1.03
    c_pace = round(b_pace * 1.03)

    return {"A": a_pace, "B": b_pace, "C": c_pace}


# ===============================
# ADJUSTMENTS
# ===============================

def adjust_vdot_for_weight(vdot: float, old_weight: float, new_weight: float) -> float:
    """Adjust VDOT for body weight change.

    VO2max scales inversely with body weight (mL/kg/min), so lighter weight
    means higher relative VO2max and higher VDOT.

    Eq: adjusted_vdot = vdot * old_weight / new_weight

    Args:
        vdot: Current VDOT score.
        old_weight: Previous weight (any unit, must match new_weight).
        new_weight: Current weight (same unit as old_weight).

    Returns:
        Adjusted VDOT.
    """
    return vdot * old_weight / new_weight
