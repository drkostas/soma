"""3-layer weight prediction (M3 Phase D).

Research basis: V2 §8.3.

Layer A: personal kcal-per-kg (EWMA over history, weeks 4+)
Layer B: Forbes-composition density (always available, function of current FM)
Layer C: glycogen/water compartment + refeed sawtooth overlays with 80% CI

Each layer is a pure function callers compose themselves. Layer A returns
None when history is too short so callers know to fall back to Layer B.
"""

from __future__ import annotations

import math
from dataclasses import dataclass


# ---------------------------------------------------------------------------
# Layer B — Forbes-composition energy density (V2 §8.3)
# ---------------------------------------------------------------------------

_FORBES_K: float = 10.4
_LEAN_KCAL_PER_KG: float = 1816.0
_FAT_KCAL_PER_KG: float = 9441.0


def forbes_energy_density_kcal_per_kg(fm_kg: float) -> float:
    """Energy density per kg of body-weight change at a given fat mass.

    Derived from Forbes partitioning: a weight change of 1 kg costs/releases
    `rho` kcal where rho is a lean-fat mix weighted by the Forbes fraction.
    """
    if fm_kg < 0:
        raise ValueError(f"fm_kg must be non-negative, got {fm_kg}")
    lean_fraction = _FORBES_K / (_FORBES_K + fm_kg)
    fat_fraction = 1.0 - lean_fraction
    return lean_fraction * _LEAN_KCAL_PER_KG + fat_fraction * _FAT_KCAL_PER_KG


# ---------------------------------------------------------------------------
# Layer A — personal kcal-per-kg EWMA (V2 §8.3)
# ---------------------------------------------------------------------------

_LAYER_A_MIN_KCAL_PER_KG: float = 5500.0
_LAYER_A_MAX_KCAL_PER_KG: float = 9500.0
_LAYER_A_WEIGHT_EMA_DAYS: int = 7
_LAYER_A_WINDOW_DAYS: int = 14


@dataclass(frozen=True)
class DayPoint:
    day: int  # 0-indexed sequential day
    intake_kcal: float
    tdee_kcal: float
    weight_kg: float


def _ema(values: list[float], half_life: int) -> list[float]:
    """Simple EWMA with given half-life (in samples). First value seeds."""
    if not values:
        return []
    alpha = 1 - math.exp(-math.log(2) / half_life)
    out = [values[0]]
    for v in values[1:]:
        out.append(out[-1] + alpha * (v - out[-1]))
    return out


def _trailing_mean(values: list[float], window: int) -> list[float]:
    """Trailing simple moving average of length `window`. No lag relative to a
    matched endpoint (vs EWMA which trails the true mean)."""
    out: list[float] = []
    for i in range(len(values)):
        start = max(0, i - window + 1)
        seg = values[start : i + 1]
        out.append(sum(seg) / len(seg))
    return out


def personal_kcal_per_kg(
    history: list[DayPoint],
    *,
    min_days: int = 28,
    window_days: int = _LAYER_A_WINDOW_DAYS,
    half_life_days: int = 28,
) -> float | None:
    """Empirical kcal-per-kg derived from the user's own history.

    Smooths weight with a 7-day EMA, then over rolling `window_days`-wide
    windows computes `cum_deficit_in_window / weight_delta_in_window`. Those
    per-window densities are combined via an EWMA with `half_life_days` and
    clamped to [5500, 9500].

    Returns None when:
    - history has fewer than `min_days` entries
    - no window produces a usable (non-zero weight-delta) signal
    """
    if len(history) < min_days:
        return None

    # 1) Smooth weight with a trailing 7-day mean — no EWMA lag, so the delta
    # across a 14-day window actually reflects 14 days of weight change.
    weights = [d.weight_kg for d in history]
    smoothed = _trailing_mean(weights, window=_LAYER_A_WEIGHT_EMA_DAYS)

    # 2) Rolling windows: window_days apart. Start only once BOTH endpoints
    # have a full trailing window — otherwise the start-of-series smoothing
    # uses fewer samples than the end, biasing the delta downward.
    per_window: list[float] = []
    first_end = window_days + _LAYER_A_WEIGHT_EMA_DAYS - 1
    for end in range(first_end, len(history)):
        start = end - window_days
        window = history[start:end]
        cum_deficit = sum(d.tdee_kcal - d.intake_kcal for d in window)
        delta = smoothed[start] - smoothed[end]  # positive if losing weight
        if abs(delta) < 0.05:
            # Noise floor: skip (avoid divide-by-small giving huge rho).
            continue
        # If cum_deficit and delta have opposite signs (user gained despite a
        # deficit, e.g. creatine load or error), the ratio is negative and
        # not meaningful for kcal-per-kg. Skip those windows too.
        if cum_deficit * delta <= 0:
            continue
        rho = cum_deficit / delta
        per_window.append(rho)

    if not per_window:
        return None

    # 3) EWMA across windows.
    smoothed_rho = _ema(per_window, half_life=half_life_days)
    raw = smoothed_rho[-1]

    # 4) Clamp.
    return max(_LAYER_A_MIN_KCAL_PER_KG, min(_LAYER_A_MAX_KCAL_PER_KG, raw))


# ---------------------------------------------------------------------------
# Layer C — glycogen/water + refeed sawtooth overlays (V2 §8.3)
# ---------------------------------------------------------------------------

_GLYCOGEN_MAX_SWING_KG: float = 1.2
_GLYCOGEN_TAU_DAYS: float = 4.0
_GLYCOGEN_CARB_SATURATION_G: float = 500.0

_REFEED_MAX_OFFSET_KG: float = 0.8
_REFEED_TAU_DAYS: float = 2.0

# 80% CI band width scalar (V2 §8.3 "80% CI band").
_CI_BAND_SCALAR: float = 0.6


@dataclass(frozen=True)
class OverlayResult:
    glycogen_swing_kg: float
    refeed_offset_kg: float
    ci_low_kg: float
    ci_high_kg: float


def glycogen_water_overlay(
    central_kg: float,
    *,
    days_since_refeed: int,
    carb_delta_g: float,
) -> OverlayResult:
    """Physiological overlays on top of a central weight prediction.

    glycogen_swing_kg is signed (positive when loaded up, negative when
    depleted). refeed_offset_kg is always ≥ 0 — it's the decaying tail of
    the last high-carb day. The CI band widens with whichever of the two
    moves the prediction more.
    """
    # Glycogen compartment: scales with |carb_delta_g| up to saturation,
    # capped at ±1.2 kg. No time decay here — the caller passes the
    # current carb delta relative to baseline.
    saturation = max(-1.0, min(1.0, carb_delta_g / _GLYCOGEN_CARB_SATURATION_G))
    glycogen_swing = saturation * _GLYCOGEN_MAX_SWING_KG

    # Refeed sawtooth: exponential decay from _REFEED_MAX_OFFSET_KG.
    if days_since_refeed < 0:
        raise ValueError(f"days_since_refeed must be ≥ 0, got {days_since_refeed}")
    refeed_offset = _REFEED_MAX_OFFSET_KG * math.exp(-days_since_refeed / _REFEED_TAU_DAYS)

    # CI band: sum of magnitudes scaled by _CI_BAND_SCALAR, symmetric.
    band = (abs(glycogen_swing) + abs(refeed_offset)) * _CI_BAND_SCALAR
    # Ensure central is strictly inside the band (invariant for callers).
    band = max(band, 0.05)

    return OverlayResult(
        glycogen_swing_kg=glycogen_swing,
        refeed_offset_kg=refeed_offset,
        ci_low_kg=central_kg - band,
        ci_high_kg=central_kg + band,
    )
