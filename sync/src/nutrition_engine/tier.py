"""BF%-tier framework — master mode selector.

Based on V13 research synthesis (docs/plans/science-research/V13-bf-tier-framework-findings.md).

Evidence basis:
- Hall 2008 Forbes inflection at 28% BF
- Forbes 2000 FFM acceleration at 20% BF
- Rossow 2013 / Helms 2014 testosterone decline onset at 15% BF
- Mountjoy 2018 IOC RED-S cliff at 10% BF
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Literal

# Hysteresis buffer — must cross boundary by this to change tier
HYSTERESIS_PCT: float = 1.0


class Tier(str, Enum):
    """BF%-based tiers for males (female schema deferred)."""
    T1 = "T1"  # >=28% obesity-class
    T2 = "T2"  # 20-28% high
    T3 = "T3"  # 15-20% lean
    T4 = "T4"  # 10-15% very lean
    T5 = "T5"  # <10% off-limits (competition only)


@dataclass(frozen=True)
class TierPolicy:
    """Policy parameters cascading from a user's BF% tier."""
    tier: Tier
    bf_range: tuple[float, float]
    rate_cap_soft_pct_per_wk: float
    rate_cap_hard_pct_per_wk: float
    protein_g_per_kg_bw: float
    protein_g_per_kg_lbm_basis: bool
    fat_floor_g_per_kg_bw_soft: float
    fat_floor_g_per_kg_bw_hard: float
    aggressive_mode_allowed: bool
    refeed_frequency_days: int
    diet_break_frequency_weeks: int
    biomarker_cadence: Literal["weekly", "daily", "daily+bloods"]
    duration_envelope_weeks: tuple[int, int]


def compute_tier_raw(bf_pct: float) -> Tier:
    """Strict boundary tier assignment (no hysteresis)."""
    if bf_pct >= 28.0:
        return Tier.T1
    if bf_pct >= 20.0:
        return Tier.T2
    if bf_pct >= 15.0:
        return Tier.T3
    if bf_pct >= 10.0:
        return Tier.T4
    return Tier.T5


# Boundary map: upper edge of each tier (ascending leanness = descending BF%)
_TIER_UPPER_BOUNDS: dict[Tier, float] = {
    Tier.T5: 10.0,   # T5 ends at 10.0, T4 begins
    Tier.T4: 15.0,   # T4 ends at 15.0, T3 begins
    Tier.T3: 20.0,   # T3 ends at 20.0, T2 begins
    Tier.T2: 28.0,   # T2 ends at 28.0, T1 begins
    Tier.T1: float("inf"),
}


def compute_tier(bf_pct: float, previous_tier: Tier | None = None) -> Tier:
    """Tier assignment with HYSTERESIS_PCT buffer to prevent flicker near boundaries.

    When moving LEANER (lower BF%): must drop ``HYSTERESIS_PCT`` below the tier's
    lower edge to transition.
    When moving FATTER (higher BF%): must rise ``HYSTERESIS_PCT`` above the tier's
    upper edge to transition.
    """
    raw = compute_tier_raw(bf_pct)
    if previous_tier is None or raw == previous_tier:
        return raw

    prev_upper = _TIER_UPPER_BOUNDS[previous_tier]

    # Map tier to numeric order for comparison
    order = {Tier.T1: 1, Tier.T2: 2, Tier.T3: 3, Tier.T4: 4, Tier.T5: 5}

    if order[raw] > order[previous_tier]:
        # raw tier is LEANER than previous; boundary to cross is previous's lower edge
        # previous's lower edge = upper bound of the tier immediately leaner
        # e.g., previous T2 (20-28), moving to T3: must go BELOW 20 - hysteresis
        leaner_tier_upper = _leaner_tier_upper_edge(previous_tier)
        threshold = leaner_tier_upper - HYSTERESIS_PCT
        if bf_pct <= threshold:
            return raw
        return previous_tier

    # raw tier is FATTER than previous
    # boundary is previous's upper edge; must exceed it + hysteresis
    threshold = prev_upper + HYSTERESIS_PCT
    if bf_pct >= threshold:
        return raw
    return previous_tier


def _leaner_tier_upper_edge(tier: Tier) -> float:
    """Return the upper edge of the tier immediately leaner than the given tier.

    For T2 (20-28), the leaner tier is T3 (15-20), whose upper edge is 20.0.
    Used to compute the lower edge of the given tier.
    """
    leaner_map = {
        Tier.T1: _TIER_UPPER_BOUNDS[Tier.T2],  # 28.0 -> T2 upper is 28, but we want T1's lower = 28
        Tier.T2: _TIER_UPPER_BOUNDS[Tier.T3],  # T2 lower edge = T3 upper = 20.0
        Tier.T3: _TIER_UPPER_BOUNDS[Tier.T4],  # T3 lower edge = T4 upper = 15.0
        Tier.T4: _TIER_UPPER_BOUNDS[Tier.T5],  # T4 lower edge = T5 upper = 10.0
        Tier.T5: 0.0,  # no tier leaner than T5
    }
    return leaner_map[tier]


def rolling_median_bf(bf_readings: list[float]) -> float:
    """Median of recent BF% readings — placeholder."""
    sorted_readings = sorted(bf_readings)
    n = len(sorted_readings)
    if n == 0:
        raise ValueError("rolling_median_bf requires at least one reading")
    if n == 1:
        return sorted_readings[0]
    if n % 2 == 0:
        return (sorted_readings[n // 2 - 1] + sorted_readings[n // 2]) / 2
    return sorted_readings[n // 2]


_TIER_POLICIES: dict[Tier, TierPolicy] = {
    Tier.T1: TierPolicy(
        tier=Tier.T1,
        bf_range=(28.0, float("inf")),
        rate_cap_soft_pct_per_wk=1.0,
        rate_cap_hard_pct_per_wk=1.25,
        protein_g_per_kg_bw=2.0,
        protein_g_per_kg_lbm_basis=False,
        fat_floor_g_per_kg_bw_soft=0.8,
        fat_floor_g_per_kg_bw_hard=0.6,
        aggressive_mode_allowed=True,
        refeed_frequency_days=14,
        diet_break_frequency_weeks=12,
        biomarker_cadence="weekly",
        duration_envelope_weeks=(12, 24),
    ),
    Tier.T2: TierPolicy(
        tier=Tier.T2,
        bf_range=(20.0, 28.0),
        # Conservative defaults for 20-25% sub-tier (matches current test user)
        rate_cap_soft_pct_per_wk=0.75,
        rate_cap_hard_pct_per_wk=1.0,
        protein_g_per_kg_bw=2.2,
        protein_g_per_kg_lbm_basis=False,
        fat_floor_g_per_kg_bw_soft=0.8,
        fat_floor_g_per_kg_bw_hard=0.6,
        aggressive_mode_allowed=True,
        refeed_frequency_days=14,
        diet_break_frequency_weeks=12,
        biomarker_cadence="weekly",
        duration_envelope_weeks=(12, 16),
    ),
    Tier.T3: TierPolicy(
        tier=Tier.T3,
        bf_range=(15.0, 20.0),
        rate_cap_soft_pct_per_wk=0.5,
        rate_cap_hard_pct_per_wk=0.75,
        protein_g_per_kg_bw=2.4,
        protein_g_per_kg_lbm_basis=False,
        fat_floor_g_per_kg_bw_soft=0.8,
        fat_floor_g_per_kg_bw_hard=0.6,
        aggressive_mode_allowed=False,  # BLOCKED at T3
        refeed_frequency_days=7,        # weekly refeeds mandatory
        diet_break_frequency_weeks=10,
        biomarker_cadence="weekly",
        duration_envelope_weeks=(16, 20),
    ),
    Tier.T4: TierPolicy(
        tier=Tier.T4,
        bf_range=(10.0, 15.0),
        rate_cap_soft_pct_per_wk=0.4,
        rate_cap_hard_pct_per_wk=0.5,
        protein_g_per_kg_bw=2.8,
        protein_g_per_kg_lbm_basis=True,  # switch to LBM basis at T4
        fat_floor_g_per_kg_bw_soft=0.8,
        fat_floor_g_per_kg_bw_hard=0.6,
        aggressive_mode_allowed=False,
        refeed_frequency_days=5,
        diet_break_frequency_weeks=8,
        biomarker_cadence="daily",
        duration_envelope_weeks=(8, 12),
    ),
    Tier.T5: TierPolicy(
        tier=Tier.T5,
        bf_range=(0.0, 10.0),
        rate_cap_soft_pct_per_wk=0.3,
        rate_cap_hard_pct_per_wk=0.4,
        protein_g_per_kg_bw=3.0,
        protein_g_per_kg_lbm_basis=True,
        fat_floor_g_per_kg_bw_soft=0.8,
        fat_floor_g_per_kg_bw_hard=0.6,
        aggressive_mode_allowed=False,
        refeed_frequency_days=3,
        diet_break_frequency_weeks=6,
        biomarker_cadence="daily+bloods",
        duration_envelope_weeks=(4, 8),
    ),
}


def get_tier_policy(tier: Tier) -> TierPolicy:
    """Return the canonical TierPolicy for a tier."""
    return _TIER_POLICIES[tier]
