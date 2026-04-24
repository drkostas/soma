"""Tests for mode availability (M2.2).

Checks whether a given (mode, tier, bf_pct) combination is allowed, with
typed reason codes when blocked. Research basis: V2 §3.2 + tier × mode table
at §2 (lines 102-107).
"""

import pytest

from nutrition_engine.mode import Mode
from nutrition_engine.mode_availability import (
    GateReason,
    ModeAvailability,
    check_mode_availability,
)
from nutrition_engine.tier import Tier


class TestResultShape:
    def test_allowed_has_no_reason(self):
        r = check_mode_availability(Mode.STANDARD, Tier.T2, bf_pct=23.5)
        assert isinstance(r, ModeAvailability)
        assert r.allowed is True
        assert r.reason is None

    def test_blocked_carries_reason(self):
        r = check_mode_availability(Mode.AGGRESSIVE, Tier.T3, bf_pct=17.0)
        assert r.allowed is False
        assert r.reason is GateReason.TIER_NOT_ALLOWED


class TestStandard:
    @pytest.mark.parametrize("tier", [Tier.T1, Tier.T2, Tier.T3, Tier.T4])
    def test_allowed_tiers(self, tier: Tier):
        # BF% within the tier band — Standard open across the deficit tiers.
        r = check_mode_availability(Mode.STANDARD, tier, bf_pct=22.0)
        assert r.allowed is True

    def test_t5_blocked(self):
        # T5 = <10% BF, deep competition territory; Standard not offered.
        r = check_mode_availability(Mode.STANDARD, Tier.T5, bf_pct=9.0)
        assert r.allowed is False
        assert r.reason is GateReason.TIER_NOT_ALLOWED


class TestAggressive:
    @pytest.mark.parametrize("tier", [Tier.T1, Tier.T2])
    def test_allowed_for_t1_t2(self, tier: Tier):
        r = check_mode_availability(Mode.AGGRESSIVE, tier, bf_pct=22.0)
        assert r.allowed is True

    @pytest.mark.parametrize("tier", [Tier.T3, Tier.T4, Tier.T5])
    def test_blocked_t3_and_leaner(self, tier: Tier):
        r = check_mode_availability(Mode.AGGRESSIVE, tier, bf_pct=14.0)
        assert r.allowed is False
        assert r.reason is GateReason.TIER_NOT_ALLOWED

    def test_bf_at_hard_floor_is_blocked(self):
        # 12.0 is the hard floor — strictly less than is also blocked.
        r = check_mode_availability(Mode.AGGRESSIVE, Tier.T2, bf_pct=12.0)
        assert r.allowed is False
        assert r.reason is GateReason.BF_BELOW_HARD_FLOOR

    def test_bf_below_hard_floor(self):
        r = check_mode_availability(Mode.AGGRESSIVE, Tier.T2, bf_pct=11.9)
        assert r.allowed is False
        assert r.reason is GateReason.BF_BELOW_HARD_FLOOR

    def test_bf_just_above_hard_floor(self):
        r = check_mode_availability(Mode.AGGRESSIVE, Tier.T2, bf_pct=12.1)
        assert r.allowed is True


class TestBulk:
    def test_t1_blocked(self):
        # T1 (>28% BF) — still needs to cut before bulking.
        r = check_mode_availability(Mode.BULK, Tier.T1, bf_pct=30.0)
        assert r.allowed is False
        assert r.reason is GateReason.TIER_NOT_ALLOWED

    @pytest.mark.parametrize("tier", [Tier.T2, Tier.T3, Tier.T4, Tier.T5])
    def test_allowed_t2_and_leaner(self, tier: Tier):
        r = check_mode_availability(Mode.BULK, tier, bf_pct=16.0)
        assert r.allowed is True


class TestAlwaysAllowed:
    @pytest.mark.parametrize("tier", list(Tier))
    def test_injured_any_tier(self, tier: Tier):
        # V2 §4.5: Injured mode overrides tier/BF% gates entirely.
        r = check_mode_availability(Mode.INJURED, tier, bf_pct=10.0)
        assert r.allowed is True

    @pytest.mark.parametrize("tier", list(Tier))
    def test_maintenance_any_tier(self, tier: Tier):
        r = check_mode_availability(Mode.MAINTENANCE, tier, bf_pct=20.0)
        assert r.allowed is True

    @pytest.mark.parametrize("tier", list(Tier))
    def test_reverse_any_tier(self, tier: Tier):
        r = check_mode_availability(Mode.REVERSE, tier, bf_pct=20.0)
        assert r.allowed is True


class TestExhaustiveMatrix:
    """Sanity: every (mode × tier) pair returns a bool + optional reason."""

    @pytest.mark.parametrize("mode", list(Mode))
    @pytest.mark.parametrize("tier", list(Tier))
    def test_no_combo_raises(self, mode: Mode, tier: Tier):
        r = check_mode_availability(mode, tier, bf_pct=20.0)
        assert isinstance(r.allowed, bool)
        if not r.allowed:
            assert isinstance(r.reason, GateReason)
