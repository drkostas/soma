"""5-tier BF%-based weekly loss rate cap.

Based on Helms 2014 + Forbes 2000 + Garthe 2011 RCT + Hall 2008.

Rate cap tiers (Standard mode):
- T1 (>=28% BF): 1.0% / 1.25% per week
- T2 (20-28%):   0.75% / 1.0% per week
- T3 (15-20%):   0.5% / 0.75% per week
- T4 (10-15%):   0.4% / 0.5% per week
- T5 (<10%):     0.3% / 0.4% per week

Aggressive mode loosens by one tier (T2 gets T1 caps, etc.).

Hybrid window: yellow when 7-day rate exceeds soft cap; red only when BOTH
7-day AND 14-day rates exceed hard cap. This suppresses false positives from
single-week glycogen/water flux.

First 14 days of a new cut phase are SUPPRESSED (glycogen/water confound
makes rate appear much faster than actual fat loss).
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Literal

from nutrition_engine.tier import Tier

Mode = Literal["standard", "aggressive"]

# Tier → (soft_cap, hard_cap) in %/week (negative = loss)
_STANDARD_RATE_CAPS: dict[Tier, tuple[float, float]] = {
    Tier.T1: (1.0, 1.25),
    Tier.T2: (0.75, 1.0),
    Tier.T3: (0.5, 0.75),
    Tier.T4: (0.4, 0.5),
    Tier.T5: (0.3, 0.4),
}

# Ordered for "loosen by one tier" in aggressive mode
_TIER_ORDER = [Tier.T5, Tier.T4, Tier.T3, Tier.T2, Tier.T1]


class RateStatus(str, Enum):
    GREEN = "green"
    YELLOW = "yellow"
    RED = "red"
    SUPPRESSED = "suppressed"


@dataclass(frozen=True)
class RateCap:
    """Soft and hard weekly rate caps (%/wk)."""
    soft_pct_per_wk: float
    hard_pct_per_wk: float


@dataclass(frozen=True)
class RateCheckResult:
    rate_7day_pct: float
    rate_14day_pct: float | None
    status: RateStatus
    soft_cap: float
    hard_cap: float


def get_rate_cap(tier: Tier, mode: Mode = "standard") -> RateCap:
    """Return (soft, hard) rate caps for a tier and mode.

    Aggressive mode loosens caps by one tier (e.g., T2 → T1 caps).
    T1 cannot loosen further.
    """
    if mode not in ("standard", "aggressive"):
        raise ValueError(f"Unknown mode: {mode!r}. Use 'standard' or 'aggressive'.")

    if mode == "aggressive":
        # Move one tier toward higher BF% in the order
        idx = _TIER_ORDER.index(tier)
        # idx: T5=0, T4=1, T3=2, T2=3, T1=4. Loosen → move toward T1 (higher idx).
        loosened_idx = min(idx + 1, len(_TIER_ORDER) - 1)
        tier = _TIER_ORDER[loosened_idx]

    soft, hard = _STANDARD_RATE_CAPS[tier]
    return RateCap(soft_pct_per_wk=soft, hard_pct_per_wk=hard)


def compute_weekly_rate_pct(
    daily_weights: list[float],
    current_weight_kg: float | None = None,
) -> float:
    """Compute weekly weight-change rate as % of current weight.

    Uses linear regression slope × 7 / current_weight × 100.
    Negative rate = losing weight; positive = gaining.

    Args:
        daily_weights: weights with most recent last, evenly-spaced daily.
        current_weight_kg: defaults to most recent weight in the list.
    """
    n = len(daily_weights)
    if n < 2:
        raise ValueError(f"Need at least 2 daily weights, got {n}")

    if current_weight_kg is None:
        current_weight_kg = daily_weights[-1]

    # Linear regression y = a + b*x, where x = day_index (0..n-1), y = weight
    mean_x = (n - 1) / 2.0
    mean_y = sum(daily_weights) / n
    num = sum((i - mean_x) * (w - mean_y) for i, w in enumerate(daily_weights))
    den = sum((i - mean_x) ** 2 for i in range(n))
    slope_kg_per_day = num / den  # positive = gaining

    weekly_rate_kg = slope_kg_per_day * 7
    return (weekly_rate_kg / current_weight_kg) * 100


def check_rate_cap(
    weights: list[float],
    tier: Tier,
    mode: Mode,
    current_weight_kg: float,
    days_since_cut_start: int,
) -> RateCheckResult:
    """Apply hybrid 7/14-day rate-cap logic.

    Rules:
    - First 14 days of a cut phase: SUPPRESSED (water/glycogen confound)
    - After day 14:
        - 7-day rate within soft cap: GREEN
        - 7-day over soft OR 7-day over hard (but 14-day under hard): YELLOW
        - BOTH 7-day AND 14-day rates over hard cap: RED

    ``weights`` should contain at least 14 daily weights (most recent last) for
    the 14-day window; if fewer, falls back to just 7-day eval.
    """
    cap = get_rate_cap(tier=tier, mode=mode)

    # Suppression during glycogen/water flush (first 14 days of cut)
    if days_since_cut_start < 14:
        # compute 7-day rate for informational output
        rate7 = _safe_rate(weights[-7:], current_weight_kg)
        return RateCheckResult(
            rate_7day_pct=rate7,
            rate_14day_pct=None,
            status=RateStatus.SUPPRESSED,
            soft_cap=cap.soft_pct_per_wk,
            hard_cap=cap.hard_pct_per_wk,
        )

    rate7 = _safe_rate(weights[-7:], current_weight_kg)
    rate14 = _safe_rate(weights[-14:], current_weight_kg) if len(weights) >= 14 else None

    # Rate sign: negative = losing. Compare magnitude against caps (positive).
    rate7_mag = abs(rate7) if rate7 < 0 else 0.0  # ignore gains for a cut
    rate14_mag = (abs(rate14) if rate14 is not None and rate14 < 0 else 0.0)

    # RED requires BOTH windows over hard cap
    if rate7_mag > cap.hard_pct_per_wk and rate14 is not None and rate14_mag > cap.hard_pct_per_wk:
        status = RateStatus.RED
    elif rate7_mag > cap.soft_pct_per_wk:
        status = RateStatus.YELLOW
    else:
        status = RateStatus.GREEN

    return RateCheckResult(
        rate_7day_pct=rate7,
        rate_14day_pct=rate14,
        status=status,
        soft_cap=cap.soft_pct_per_wk,
        hard_cap=cap.hard_pct_per_wk,
    )


def _safe_rate(weights: list[float], current_weight_kg: float) -> float:
    """Compute weekly rate, guarding against <2 points."""
    if len(weights) < 2:
        return 0.0
    return compute_weekly_rate_pct(weights, current_weight_kg=current_weight_kg)
