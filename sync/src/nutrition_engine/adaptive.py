"""M5 Phase A — Adaptive Systems core (V2 §4).

Four adaptive subsystems that react to the user's actual observed data
rather than relying on fixed formulas:

M5.1 Adaptive TDEE — reconcile predicted TDEE with actual intake + weight change
M5.2 Refeed Pressure Score — composite 0-100 trigger for suggesting a refeed
M5.3 Diet Break level — 4-level suggestion ramp based on deficit duration
M5.4 Plateau Detection — gated on adaptive-TDEE stability, with type classifier
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from enum import Enum

from nutrition_engine.tier import Tier
from nutrition_engine.weight_prediction import DayPoint


# ---------------------------------------------------------------------------
# M5.1 Adaptive TDEE
# ---------------------------------------------------------------------------

_KCAL_PER_KG_BW: float = 7700.0  # V2 §4.1 reconciliation constant
_ADAPTIVE_TDEE_MIN_DAYS: int = 7
_ADAPTIVE_TDEE_WINDOW_DAYS: int = 14
_DRIFT_THRESHOLD_PCT: float = 10.0


@dataclass(frozen=True)
class AdaptiveTdeeResult:
    effective_tdee: float
    reported_tdee: float
    discrepancy_pct: float
    drift_flag: bool


def compute_adaptive_tdee(
    days: list[DayPoint],
    *,
    window_days: int = _ADAPTIVE_TDEE_WINDOW_DAYS,
    min_days: int = _ADAPTIVE_TDEE_MIN_DAYS,
) -> AdaptiveTdeeResult | None:
    """Reconcile a user's reported TDEE with observed intake + weight change.

    effective_tdee = avg_intake - (weight_delta_kg × 7700 / days)
    A positive weight_delta (weight loss) adds kcal back to explain the loss.
    Returns None when fewer than min_days of data are available.
    """
    if len(days) < min_days:
        return None

    window = days[-window_days:]
    n = len(window)
    avg_intake = sum(d.intake_kcal for d in window) / n
    weight_delta = window[0].weight_kg - window[-1].weight_kg  # positive if losing
    days_span = max(1, n - 1)
    effective_tdee = avg_intake + (weight_delta * _KCAL_PER_KG_BW / days_span)

    # Average reported TDEE across the window
    reported = sum(d.tdee_kcal for d in window) / n
    if reported <= 0:
        return None

    discrepancy_pct = abs(effective_tdee - reported) / reported * 100

    # Drift flag: discrepancy > 10% on 5+ of the last 7 days. We approximate
    # "last 7 days" as a trailing 7-day window of day-level comparisons.
    drift_flag = False
    if n >= 7:
        recent = window[-7:]
        drift_count = 0
        for i, d in enumerate(recent):
            if d.tdee_kcal <= 0:
                continue
            # Per-day effective TDEE: use the 14-day window total applied
            # day-wise for a stable per-day metric.
            day_discrepancy = abs(effective_tdee - d.tdee_kcal) / d.tdee_kcal * 100
            if day_discrepancy > _DRIFT_THRESHOLD_PCT:
                drift_count += 1
        drift_flag = drift_count >= 5

    return AdaptiveTdeeResult(
        effective_tdee=effective_tdee,
        reported_tdee=reported,
        discrepancy_pct=discrepancy_pct,
        drift_flag=drift_flag,
    )


# ---------------------------------------------------------------------------
# M5.2 Refeed Pressure Score
# ---------------------------------------------------------------------------


def compute_refeed_pressure_score(
    *,
    deficit_days: int,
    weight_stall_days: int,
    hrv_7d_trend_pct: float,
    readiness_avg: float,
    bf_tier: Tier,
    weight_loss_velocity_pct_per_wk: float,
) -> int:
    """Composite 0-100 score that triggers app-suggested refeed at ≥ 60.

    Each signal contributes up to its weighted max; the final sum is clamped
    to [0, 100]. Weights from V2 §4.2.
    """
    score = 0.0

    # Deficit-days: 25 points ramped linearly from 0 → 56 days
    score += min(25.0, deficit_days / 56 * 25)

    # Weight stall: 20 points ramped linearly from 0 → 14 days
    score += min(20.0, weight_stall_days / 14 * 20)

    # HRV down-trend: 15 points if 7d trend ≤ -5%, ramps up to -15% for max
    if hrv_7d_trend_pct <= -5:
        score += min(15.0, abs(hrv_7d_trend_pct) / 15 * 15)

    # Readiness below 60: up to 10 points (lower readiness = more pressure)
    if readiness_avg < 60:
        score += min(10.0, (60 - readiness_avg) / 30 * 10)

    # BF tier: leaner tiers add pressure (MPS/metabolic adaptation risk)
    tier_bonus = {Tier.T1: 0, Tier.T2: 0, Tier.T3: 5, Tier.T4: 10, Tier.T5: 10}
    score += tier_bonus[bf_tier]

    # Weight-loss velocity: 20 points if > 1.0%/wk (generic hard-cap proxy)
    if weight_loss_velocity_pct_per_wk > 1.0:
        score += min(20.0, (weight_loss_velocity_pct_per_wk - 1.0) / 1.0 * 20)

    return max(0, min(100, round(score)))


# ---------------------------------------------------------------------------
# M5.3 Diet Break level
# ---------------------------------------------------------------------------


class DietBreakLevel(str, Enum):
    NONE = "none"
    SUGGESTED = "suggested"
    STRONG = "strong"
    MANDATORY = "mandatory"


def recommend_diet_break(deficit_duration_days: int) -> DietBreakLevel:
    """Days-in-deficit → escalating diet-break recommendation level."""
    if deficit_duration_days < 56:
        return DietBreakLevel.NONE
    if deficit_duration_days < 84:
        return DietBreakLevel.SUGGESTED
    if deficit_duration_days < 112:
        return DietBreakLevel.STRONG
    return DietBreakLevel.MANDATORY


# ---------------------------------------------------------------------------
# M5.4 Plateau detection
# ---------------------------------------------------------------------------

_PLATEAU_MIN_DAYS: int = 21
_PLATEAU_SLOPE_THRESHOLD_KG_PER_WK: float = 0.185
_PLATEAU_WATER_DAYS: int = 14


class PlateauType(str, Enum):
    ADAPTATION = "adaptation"
    INTAKE_CREEP = "intake_creep"
    WATER = "water"
    RECOMP = "recomp"


@dataclass(frozen=True)
class PlateauResult:
    is_plateau: bool
    ema_slope_kg_per_wk: float
    type: PlateauType | None
    days_stalled: int


def _linear_slope_kg_per_day(weights: list[float]) -> float:
    """Simple least-squares slope of weight vs. day-index."""
    n = len(weights)
    if n < 2:
        return 0.0
    x_mean = (n - 1) / 2
    y_mean = sum(weights) / n
    num = 0.0
    den = 0.0
    for i, w in enumerate(weights):
        num += (i - x_mean) * (w - y_mean)
        den += (i - x_mean) ** 2
    return num / den if den else 0.0


def detect_plateau(
    weight_days: list[DayPoint],
    *,
    hunger_elevated: bool = False,
    strength_improving: bool = False,
    tdee_stable: bool,
) -> PlateauResult:
    """Identify a plateau from weight history + subjective training signals.

    Gates: need ≥ 21 days of data AND a stable adaptive-TDEE signal (else we
    can't distinguish a true plateau from a data artifact).
    """
    if len(weight_days) < _PLATEAU_MIN_DAYS:
        return PlateauResult(
            is_plateau=False, ema_slope_kg_per_wk=0.0,
            type=None, days_stalled=0,
        )

    slope_per_day = _linear_slope_kg_per_day([d.weight_kg for d in weight_days])
    slope_per_wk = slope_per_day * 7

    # Count days since last weight decrease of more than half a sigma
    days_stalled = len(weight_days)  # approximation — all data points count

    if strength_improving:
        # Recomp: body comp changing even though weight isn't → not a plateau.
        return PlateauResult(
            is_plateau=False, ema_slope_kg_per_wk=slope_per_wk,
            type=PlateauType.RECOMP, days_stalled=days_stalled,
        )

    if not tdee_stable:
        return PlateauResult(
            is_plateau=False, ema_slope_kg_per_wk=slope_per_wk,
            type=None, days_stalled=days_stalled,
        )

    # Must be stalling: slope must be shallower than -0.185 kg/wk (i.e.
    # losing LESS than 0.185/wk means it's a plateau).
    if abs(slope_per_wk) > _PLATEAU_SLOPE_THRESHOLD_KG_PER_WK:
        return PlateauResult(
            is_plateau=False, ema_slope_kg_per_wk=slope_per_wk,
            type=None, days_stalled=days_stalled,
        )

    # Classify type from subjective signals
    if hunger_elevated:
        plateau_type = PlateauType.ADAPTATION
    elif days_stalled < _PLATEAU_WATER_DAYS:
        plateau_type = PlateauType.WATER
    else:
        plateau_type = PlateauType.INTAKE_CREEP

    return PlateauResult(
        is_plateau=True, ema_slope_kg_per_wk=slope_per_wk,
        type=plateau_type, days_stalled=days_stalled,
    )
