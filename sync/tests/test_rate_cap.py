"""Tests for 5-tier rate cap (M1.4)."""

import pytest

from nutrition_engine.rate_cap import (
    RateCap,
    RateStatus,
    RateCheckResult,
    get_rate_cap,
    compute_weekly_rate_pct,
    check_rate_cap,
)
from nutrition_engine.tier import Tier


class TestGetRateCap:
    """Per-tier rate caps in Standard mode."""

    def test_t1_standard(self):
        c = get_rate_cap(Tier.T1, mode="standard")
        assert c.soft_pct_per_wk == 1.0
        assert c.hard_pct_per_wk == 1.25

    def test_t2_standard_current_user(self):
        c = get_rate_cap(Tier.T2, mode="standard")
        assert c.soft_pct_per_wk == 0.75
        assert c.hard_pct_per_wk == 1.0

    def test_t3_standard(self):
        c = get_rate_cap(Tier.T3, mode="standard")
        assert c.soft_pct_per_wk == 0.5
        assert c.hard_pct_per_wk == 0.75

    def test_t4_standard(self):
        c = get_rate_cap(Tier.T4, mode="standard")
        assert c.soft_pct_per_wk == 0.4
        assert c.hard_pct_per_wk == 0.5

    def test_t5_standard(self):
        c = get_rate_cap(Tier.T5, mode="standard")
        assert c.soft_pct_per_wk == 0.3
        assert c.hard_pct_per_wk == 0.4


class TestAggressiveModeLoosens:
    """Aggressive mode loosens rate cap by one tier (T2→T1 caps, etc.)."""

    def test_t2_aggressive_uses_t1_caps(self):
        c = get_rate_cap(Tier.T2, mode="aggressive")
        assert c.soft_pct_per_wk == 1.0   # T1 soft cap
        assert c.hard_pct_per_wk == 1.25  # T1 hard cap

    def test_t1_aggressive_stays_at_t1(self):
        # Can't loosen beyond T1
        c = get_rate_cap(Tier.T1, mode="aggressive")
        assert c.soft_pct_per_wk == 1.0
        assert c.hard_pct_per_wk == 1.25

    def test_t3_aggressive_blocked_by_tier_policy(self):
        # Per V13 + M1.1: Aggressive mode contraindicated at T3+
        # get_rate_cap should still return a value but flag the block elsewhere
        # For this test, we just check it returns T2 caps (loosens to T2)
        c = get_rate_cap(Tier.T3, mode="aggressive")
        assert c.soft_pct_per_wk == 0.75  # T2 soft
        assert c.hard_pct_per_wk == 1.0   # T2 hard

    def test_invalid_mode_raises(self):
        with pytest.raises(ValueError):
            get_rate_cap(Tier.T2, mode="bulk")


class TestComputeWeeklyRatePct:
    """Weekly rate calculation from daily weight history."""

    def test_linear_decrease_1pct_per_week(self):
        # 74.2 kg losing exactly 1% per week = 0.742 kg/week = 0.106 kg/day
        # Oldest first (i=0), newest last (i=7).
        weights = [74.2 - 0.106 * i for i in range(8)]  # 8 days, decreasing
        rate = compute_weekly_rate_pct(weights)
        # Rate should be negative (losing) and close to -1%
        assert -1.1 < rate < -0.9

    def test_stable_weight_near_zero(self):
        weights = [74.2] * 14
        rate = compute_weekly_rate_pct(weights)
        assert abs(rate) < 0.1

    def test_gain_positive_rate(self):
        # Gaining 0.5% per week
        weights = [74.2 + 0.053 * i for i in range(8)]  # +0.053 kg/day
        rate = compute_weekly_rate_pct(weights)
        assert 0.4 < rate < 0.6

    def test_too_few_points_raises(self):
        with pytest.raises(ValueError):
            compute_weekly_rate_pct([74.2])  # need minimum 2


class TestCheckRateCap:
    """Traffic-light status with hybrid 7/14-day window."""

    def _losing_weights(self, daily_pct: float, days: int, start_weight: float = 74.2) -> list[float]:
        """Generate weights losing at ``daily_pct`` percent of weight per day.

        Oldest first (index 0), newest last (index days-1).
        weights[0] = start_weight; weights[-1] = start_weight × (1 - daily_pct/100)^(days-1)
        (approximated linearly for simplicity).
        """
        daily_kg_loss = start_weight * daily_pct / 100
        return [start_weight - daily_kg_loss * i for i in range(days)]

    def test_within_soft_green(self):
        # Losing 0.5%/wk → 0.071%/day. For T2 user, soft=0.75% hard=1.0%. Within both.
        weights = self._losing_weights(daily_pct=0.071, days=14)
        result = check_rate_cap(
            weights=weights, tier=Tier.T2, mode="standard",
            current_weight_kg=weights[-1], days_since_cut_start=30,
        )
        assert result.status is RateStatus.GREEN

    def test_over_soft_only_yellow(self):
        # Losing 0.9%/wk (over soft 0.75, under hard 1.0). 0.129%/day.
        # 7-day rate ~0.9, 14-day might be similar → yellow (not red because 14d not over hard)
        weights = self._losing_weights(daily_pct=0.129, days=14)
        result = check_rate_cap(
            weights=weights, tier=Tier.T2, mode="standard",
            current_weight_kg=weights[-1], days_since_cut_start=30,
        )
        assert result.status is RateStatus.YELLOW

    def test_both_windows_over_hard_red(self):
        # Losing 1.5%/wk sustained over 14 days. 0.214%/day.
        # Both 7-day and 14-day are over hard cap 1.0% → RED
        weights = self._losing_weights(daily_pct=0.214, days=14)
        result = check_rate_cap(
            weights=weights, tier=Tier.T2, mode="standard",
            current_weight_kg=weights[-1], days_since_cut_start=30,
        )
        assert result.status is RateStatus.RED

    def test_only_7day_over_hard_still_yellow(self):
        # Prior 7 days stable, then last 7 days lose ~1.2%/wk.
        # 7-day window (last 7 only): over hard 1.0
        # 14-day window (stable then lose): 7 days stable + 7 days lose → slope = half → ~0.6%/wk < hard 1.0
        # Per research: BOTH must be over hard for RED → this is YELLOW
        stable_week = [74.2] * 7  # days 0..6 at 74.2
        # Start losing on day 7; 0.171%/day × 7 days
        daily_loss = 74.2 * 0.171 / 100
        fast_week = [74.2 - daily_loss * (i + 1) for i in range(7)]  # days 7..13
        weights = stable_week + fast_week  # 14 days total, oldest→newest
        result = check_rate_cap(
            weights=weights, tier=Tier.T2, mode="standard",
            current_weight_kg=weights[-1], days_since_cut_start=30,
        )
        # 7-day rate is over hard, 14-day isn't → YELLOW (not RED)
        assert result.status is RateStatus.YELLOW

    def test_first_14_days_suppressed(self):
        # Fast loss in first 14 days (glycogen/water confound)
        weights = self._losing_weights(daily_pct=0.3, days=14)
        result = check_rate_cap(
            weights=weights, tier=Tier.T2, mode="standard",
            current_weight_kg=weights[-1], days_since_cut_start=7,
        )
        assert result.status is RateStatus.SUPPRESSED

    def test_day_15_no_longer_suppressed(self):
        # Same fast loss but beyond day 14
        weights = self._losing_weights(daily_pct=0.3, days=14)
        result = check_rate_cap(
            weights=weights, tier=Tier.T2, mode="standard",
            current_weight_kg=weights[-1], days_since_cut_start=15,
        )
        assert result.status is RateStatus.RED  # suppression lifted

    def test_aggressive_mode_loosens(self):
        # At Aggressive T2 (caps of T1: 1.0/1.25), 1.1%/wk is yellow (over soft)
        # Same rate in Standard T2 (caps 0.75/1.0) would be red
        weights = self._losing_weights(daily_pct=0.157, days=14)

        standard_result = check_rate_cap(
            weights=weights, tier=Tier.T2, mode="standard",
            current_weight_kg=weights[-1], days_since_cut_start=30,
        )
        # 1.1%/wk sustained: 7-day ~1.1, 14-day ~1.1, both over hard 1.0 → RED in standard
        assert standard_result.status is RateStatus.RED

        aggressive_result = check_rate_cap(
            weights=weights, tier=Tier.T2, mode="aggressive",
            current_weight_kg=weights[-1], days_since_cut_start=30,
        )
        # Same weights but caps 1.0/1.25: 1.1 over soft but under hard → YELLOW
        assert aggressive_result.status is RateStatus.YELLOW


class TestCurrentUser:
    """Current user scenarios — 74.2 kg, 23.5% BF, Tier T2."""

    def test_current_149_pct_per_wk_is_red(self):
        # Research flagged user at 1.49%/wk current — definitely red in Standard T2
        # Simulate: 0.213%/day × 14 days, oldest first
        start = 74.2
        daily_loss = start * 0.00213
        weights = [start - daily_loss * i for i in range(14)]
        result = check_rate_cap(
            weights=weights, tier=Tier.T2, mode="standard",
            current_weight_kg=weights[-1], days_since_cut_start=30,
        )
        assert result.status is RateStatus.RED
        # Confirm the measured rate is around -1.4 to -1.5%
        assert -1.7 < result.rate_7day_pct < -1.3

    def test_user_goal_stays_green_at_07_pct(self):
        # User's stated tier is T2 with soft cap 0.75. 0.7%/wk sustained → GREEN
        # 0.1%/day × 14 days, oldest first
        start = 74.2
        daily_loss = start * 0.001  # 0.1%/day → ~0.7%/week
        weights = [start - daily_loss * i for i in range(14)]
        result = check_rate_cap(
            weights=weights, tier=Tier.T2, mode="standard",
            current_weight_kg=weights[-1], days_since_cut_start=30,
        )
        assert result.status is RateStatus.GREEN
