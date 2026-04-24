"""Tests for mode transition state machine (M2.3).

Research basis:
- V2 §3.2 (post-aggressive mandatory reverse 2-6 weeks)
- V2 §5.2 (cut → maintenance 3-week ramp preferred, not enforced)
- V2 §6.4 (cut → bulk requires 4-week reverse bridge; bulk → cut abrupt OK)
- V2 §4.5 (injured overrides other gates)
"""

import pytest

from nutrition_engine.mode import Mode
from nutrition_engine.mode_transitions import (
    TransitionReason,
    TransitionResult,
    check_transition,
)
from nutrition_engine.tier import Tier


DEFAULT_TIER = Tier.T2
DEFAULT_BF = 23.5


def _check(current: Mode, next_mode: Mode, tier: Tier = DEFAULT_TIER, bf: float = DEFAULT_BF):
    return check_transition(current, next_mode, tier=tier, bf_pct=bf)


class TestResultShape:
    def test_allowed_has_no_reason(self):
        r = _check(Mode.STANDARD, Mode.MAINTENANCE)
        assert isinstance(r, TransitionResult)
        assert r.allowed is True
        assert r.reason is None
        assert r.requires_bridge is None

    def test_blocked_carries_reason(self):
        r = _check(Mode.AGGRESSIVE, Mode.STANDARD)
        assert r.allowed is False
        assert r.reason is TransitionReason.AGGRESSIVE_REQUIRES_REVERSE


class TestSameMode:
    @pytest.mark.parametrize("mode", list(Mode))
    def test_noop_transition_allowed(self, mode: Mode):
        # Staying in the current mode is trivially allowed.
        r = _check(mode, mode)
        assert r.allowed is True


class TestAggressiveExitRequiresReverse:
    # V2 §3.2: mandatory reverse diet 2-6 weeks after aggressive block.

    @pytest.mark.parametrize("target", [Mode.STANDARD, Mode.MAINTENANCE])
    def test_aggressive_to_non_reverse_blocked(self, target: Mode):
        # Aggressive → Bulk is covered by TestBulkRequiresReverseBridge with
        # the more actionable REQUIRES_REVERSE_BRIDGE reason code.
        r = _check(Mode.AGGRESSIVE, target)
        assert r.allowed is False
        assert r.reason is TransitionReason.AGGRESSIVE_REQUIRES_REVERSE

    def test_aggressive_to_reverse_allowed(self):
        r = _check(Mode.AGGRESSIVE, Mode.REVERSE)
        assert r.allowed is True

    def test_aggressive_to_injured_allowed(self):
        # Injury is always an escape hatch.
        r = _check(Mode.AGGRESSIVE, Mode.INJURED)
        assert r.allowed is True


class TestBulkRequiresReverseBridge:
    # V2 §6.4: Cut → Bulk needs 4-week reverse diet bridge.

    @pytest.mark.parametrize("cut_mode", [Mode.STANDARD, Mode.AGGRESSIVE])
    def test_cut_to_bulk_requires_bridge(self, cut_mode: Mode):
        r = _check(cut_mode, Mode.BULK)
        assert r.allowed is False
        assert r.reason is TransitionReason.REQUIRES_REVERSE_BRIDGE
        assert r.requires_bridge is Mode.REVERSE

    def test_reverse_to_bulk_allowed(self):
        r = _check(Mode.REVERSE, Mode.BULK)
        assert r.allowed is True

    def test_maintenance_to_bulk_allowed_without_bridge(self):
        # Maintenance is already the destination a reverse targets, so
        # moving Maintenance → Bulk doesn't require another reverse loop.
        r = _check(Mode.MAINTENANCE, Mode.BULK)
        assert r.allowed is True


class TestBulkExits:
    # V2 §6.4: Bulk → Cut abrupt OK; Bulk → Maintenance user-driven ramp.

    @pytest.mark.parametrize("target", [Mode.STANDARD, Mode.AGGRESSIVE, Mode.MAINTENANCE])
    def test_bulk_to_anything_downstream_allowed(self, target: Mode):
        # T3 so Aggressive will fail on availability (covered below)
        r = _check(Mode.BULK, target, tier=Tier.T2, bf=22.0)
        assert r.allowed is True

    def test_bulk_to_reverse_allowed(self):
        r = _check(Mode.BULK, Mode.REVERSE)
        assert r.allowed is True


class TestInjuredEscapeHatch:
    @pytest.mark.parametrize("current", list(Mode))
    def test_any_to_injured_allowed(self, current: Mode):
        r = _check(current, Mode.INJURED)
        assert r.allowed is True

    @pytest.mark.parametrize("target", [Mode.STANDARD, Mode.MAINTENANCE, Mode.BULK])
    def test_injured_to_target_runs_availability_gate(self, target: Mode):
        # Re-entering a normal mode from injured is subject to mode availability.
        r = _check(Mode.INJURED, target, tier=Tier.T2, bf=22.0)
        assert r.allowed is True

    def test_injured_to_aggressive_blocked_at_t3(self):
        # Availability gate still runs on exit from Injured.
        r = _check(Mode.INJURED, Mode.AGGRESSIVE, tier=Tier.T3, bf=17.0)
        assert r.allowed is False
        assert r.reason is TransitionReason.MODE_NOT_AVAILABLE


class TestAvailabilityPropagates:
    def test_standard_to_aggressive_blocks_at_t3(self):
        r = _check(Mode.STANDARD, Mode.AGGRESSIVE, tier=Tier.T3, bf=17.0)
        assert r.allowed is False
        assert r.reason is TransitionReason.MODE_NOT_AVAILABLE

    def test_maintenance_to_bulk_blocks_at_t1(self):
        # T1 = >28% BF — Bulk is tier-blocked.
        r = _check(Mode.MAINTENANCE, Mode.BULK, tier=Tier.T1, bf=30.0)
        assert r.allowed is False
        assert r.reason is TransitionReason.MODE_NOT_AVAILABLE


class TestExhaustiveMatrix:
    """Every (current, next) pair resolves without raising."""

    @pytest.mark.parametrize("current", list(Mode))
    @pytest.mark.parametrize("next_mode", list(Mode))
    def test_no_pair_raises(self, current: Mode, next_mode: Mode):
        r = _check(current, next_mode)
        assert isinstance(r.allowed, bool)
        if not r.allowed:
            assert isinstance(r.reason, TransitionReason)
