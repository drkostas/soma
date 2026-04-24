"""Tests for BF% tier framework (M1.1)."""

from nutrition_engine.tier import (
    Tier,
    TierPolicy,
    compute_tier_raw,
    compute_tier,
    get_tier_policy,
    rolling_median_bf,
    HYSTERESIS_PCT,
)


class TestTierBoundaries:
    """Raw boundary assignment without hysteresis."""

    def test_t1_above_28(self):
        assert compute_tier_raw(30.0) == Tier.T1
        assert compute_tier_raw(28.0) == Tier.T1
        assert compute_tier_raw(50.0) == Tier.T1

    def test_t2_range_20_to_28(self):
        assert compute_tier_raw(27.9) == Tier.T2
        assert compute_tier_raw(23.5) == Tier.T2  # current test user
        assert compute_tier_raw(20.0) == Tier.T2

    def test_t3_range_15_to_20(self):
        assert compute_tier_raw(19.9) == Tier.T3
        assert compute_tier_raw(15.0) == Tier.T3

    def test_t4_range_10_to_15(self):
        assert compute_tier_raw(14.9) == Tier.T4
        assert compute_tier_raw(10.0) == Tier.T4

    def test_t5_below_10(self):
        assert compute_tier_raw(9.9) == Tier.T5
        assert compute_tier_raw(5.0) == Tier.T5


class TestHysteresis:
    """Must cross boundary by HYSTERESIS_PCT to change tier."""

    def test_no_previous_uses_raw(self):
        assert compute_tier(23.5) == Tier.T2
        assert compute_tier(19.5) == Tier.T3

    def test_staying_inside_range(self):
        assert compute_tier(23.5, previous_tier=Tier.T2) == Tier.T2

    def test_going_leaner_requires_buffer(self):
        # T2 boundary is 20.0. Leaner transition requires BF <= 19.0 (20 - 1% hysteresis)
        assert compute_tier(19.5, previous_tier=Tier.T2) == Tier.T2  # inside buffer
        assert compute_tier(19.0, previous_tier=Tier.T2) == Tier.T3  # clears buffer
        assert compute_tier(18.5, previous_tier=Tier.T2) == Tier.T3  # well past

    def test_going_fatter_requires_buffer(self):
        # T3 boundary is 20.0. Fatter transition requires BF >= 21.0 (20 + 1% hysteresis)
        assert compute_tier(20.5, previous_tier=Tier.T3) == Tier.T3  # inside buffer
        assert compute_tier(21.0, previous_tier=Tier.T3) == Tier.T2  # clears buffer
        assert compute_tier(22.0, previous_tier=Tier.T3) == Tier.T2  # well past

    def test_hysteresis_at_every_boundary(self):
        # T1↔T2 at 28.0
        assert compute_tier(27.5, previous_tier=Tier.T1) == Tier.T1  # inside
        assert compute_tier(27.0, previous_tier=Tier.T1) == Tier.T2  # clears
        # T3↔T4 at 15.0
        assert compute_tier(14.5, previous_tier=Tier.T3) == Tier.T3  # inside
        assert compute_tier(14.0, previous_tier=Tier.T3) == Tier.T4  # clears
        # T4↔T5 at 10.0
        assert compute_tier(9.5, previous_tier=Tier.T4) == Tier.T4  # inside
        assert compute_tier(9.0, previous_tier=Tier.T4) == Tier.T5  # clears


class TestRollingMedian:
    """Median of recent BF% readings prevents single-measurement tier flicker."""

    def test_three_readings_odd(self):
        assert rolling_median_bf([23.0, 24.0, 22.0]) == 23.0
        assert rolling_median_bf([25.0, 20.0, 21.0]) == 21.0

    def test_single_reading(self):
        assert rolling_median_bf([23.0]) == 23.0

    def test_two_readings_averaged(self):
        assert rolling_median_bf([23.0, 25.0]) == 24.0

    def test_empty_raises(self):
        import pytest
        with pytest.raises(ValueError):
            rolling_median_bf([])


class TestTierPolicies:
    """Per-tier policy parameters from V13 master framework."""

    def test_t1_policy(self):
        p = get_tier_policy(Tier.T1)
        assert p.tier == Tier.T1
        assert p.rate_cap_soft_pct_per_wk == 1.0
        assert p.rate_cap_hard_pct_per_wk == 1.25
        assert p.aggressive_mode_allowed is True
        assert p.fat_floor_g_per_kg_bw_soft == 0.8
        assert p.fat_floor_g_per_kg_bw_hard == 0.6

    def test_t2_policy(self):
        p = get_tier_policy(Tier.T2)
        assert p.rate_cap_soft_pct_per_wk == 0.75  # for 20-25% sub-tier (conservative)
        assert p.rate_cap_hard_pct_per_wk == 1.0
        assert p.aggressive_mode_allowed is True
        assert p.protein_g_per_kg_bw == 2.2

    def test_t3_policy_blocks_aggressive(self):
        p = get_tier_policy(Tier.T3)
        assert p.aggressive_mode_allowed is False  # CRITICAL: blocked at T3+
        assert p.rate_cap_hard_pct_per_wk == 0.75
        assert p.refeed_frequency_days == 7  # weekly refeeds from T3

    def test_t4_policy(self):
        p = get_tier_policy(Tier.T4)
        assert p.aggressive_mode_allowed is False
        assert p.protein_g_per_kg_lbm_basis is True  # switches to LBM basis
        assert p.biomarker_cadence in ("daily", "daily+bloods")

    def test_t5_policy_strict(self):
        p = get_tier_policy(Tier.T5)
        assert p.aggressive_mode_allowed is False
        assert p.rate_cap_hard_pct_per_wk <= 0.5


class TestCurrentUser:
    """Current test user: 31yo male, 74.2 kg, 23.5% BF, cutting toward 15%."""

    def test_current_tier_is_t2(self):
        assert compute_tier_raw(23.5) == Tier.T2

    def test_target_tier_is_t3(self):
        assert compute_tier_raw(15.0) == Tier.T3

    def test_progression_path(self):
        """User moves through BF% range. Verify tier transitions respect hysteresis."""
        current = Tier.T2
        # Staying in T2 through the cut
        for bf in [23.5, 22.0, 21.0, 20.5, 20.0, 19.5]:
            current = compute_tier(bf, previous_tier=current)
            assert current == Tier.T2, f"Should stay T2 at BF {bf}"

        # Transition at 19.0 (clears hysteresis from 20.0 boundary)
        current = compute_tier(19.0, previous_tier=current)
        assert current == Tier.T3

        # Aggressive mode should now be blocked
        assert get_tier_policy(current).aggressive_mode_allowed is False
