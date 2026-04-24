"""Tests for Mode enum + per-mode config (M2.1).

Research basis: Nutrition Science v2 §3.2 (Aggressive), §5 (Maintenance),
§6 (Bulk), §4.5 (Injured). 6 modes with tier gating, BF% hard floors,
and bridge requirements.
"""

import pytest

from nutrition_engine.mode import (
    Mode,
    ModeConfig,
    get_mode_config,
)
from nutrition_engine.tier import Tier


class TestModeEnum:
    def test_has_six_members(self):
        assert len(Mode) == 6

    def test_string_values(self):
        assert Mode.STANDARD.value == "standard"
        assert Mode.AGGRESSIVE.value == "aggressive"
        assert Mode.REVERSE.value == "reverse"
        assert Mode.MAINTENANCE.value == "maintenance"
        assert Mode.BULK.value == "bulk"
        assert Mode.INJURED.value == "injured"


class TestGetModeConfig:
    def test_standard(self):
        c = get_mode_config(Mode.STANDARD)
        assert isinstance(c, ModeConfig)
        # Standard is available to anyone who isn't dangerously lean.
        assert c.tier_allowed == {Tier.T1, Tier.T2, Tier.T3, Tier.T4}
        assert c.bf_hard_floor_pct is None
        assert c.requires_reverse_bridge_from == set()
        assert c.max_duration_days is None

    def test_aggressive(self):
        # V2 §3.2: T1-T2 only, BF% <12% hard contraindication,
        # duration capped at 12 weeks (700-900 kcal envelope).
        c = get_mode_config(Mode.AGGRESSIVE)
        assert c.tier_allowed == {Tier.T1, Tier.T2}
        assert c.bf_hard_floor_pct == 12.0
        assert c.requires_reverse_bridge_from == set()
        assert c.max_duration_days == 84  # 12 weeks

    def test_reverse(self):
        c = get_mode_config(Mode.REVERSE)
        assert c.tier_allowed == {Tier.T1, Tier.T2, Tier.T3, Tier.T4, Tier.T5}
        assert c.bf_hard_floor_pct is None
        assert c.requires_reverse_bridge_from == set()
        # V2 §3.2 post-aggressive: 2-6 weeks reverse.
        assert c.max_duration_days == 42  # 6 weeks ceiling

    def test_maintenance(self):
        c = get_mode_config(Mode.MAINTENANCE)
        assert c.tier_allowed == {Tier.T1, Tier.T2, Tier.T3, Tier.T4, Tier.T5}
        assert c.bf_hard_floor_pct is None
        assert c.requires_reverse_bridge_from == set()
        # V2 §5: indefinite
        assert c.max_duration_days is None

    def test_bulk(self):
        # V2 §6: lean bulk is for people not already obese. Tier-level block
        # at T1 (>28% BF) keeps obese users from starting a bulk.
        c = get_mode_config(Mode.BULK)
        assert c.tier_allowed == {Tier.T2, Tier.T3, Tier.T4, Tier.T5}
        assert c.bf_hard_floor_pct is None
        # V2 §6.4: Cut → Bulk requires 4-week reverse diet bridge.
        assert c.requires_reverse_bridge_from == {Mode.STANDARD, Mode.AGGRESSIVE}
        # V2 §6.1: 12-20 week bulk block.
        assert c.max_duration_days == 140  # 20 weeks

    def test_injured(self):
        # V2 §4.5: injured mode overrides other gates — always allowed.
        c = get_mode_config(Mode.INJURED)
        assert c.tier_allowed == {Tier.T1, Tier.T2, Tier.T3, Tier.T4, Tier.T5}
        assert c.bf_hard_floor_pct is None
        assert c.requires_reverse_bridge_from == set()
        # Phased (acute/subacute/chronic) → no hard cap.
        assert c.max_duration_days is None

    def test_config_is_frozen(self):
        c = get_mode_config(Mode.STANDARD)
        with pytest.raises(Exception):
            c.tier_allowed = {Tier.T1}  # type: ignore[misc]


class TestAllModesCovered:
    @pytest.mark.parametrize("mode", list(Mode))
    def test_every_mode_has_config(self, mode: Mode):
        # Guard against forgetting to add a config when new modes are introduced.
        c = get_mode_config(mode)
        assert isinstance(c, ModeConfig)
        assert c.tier_allowed, f"{mode} has no allowed tiers"
