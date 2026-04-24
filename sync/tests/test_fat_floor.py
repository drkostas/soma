"""Tests for fat floor enforcement (M1.5).

Research basis: Whittaker & Wu 2021 T-meta, Volek 1997, Wang 2005.
Fat < 20% of calories → testosterone drops. Floor protects hormonal function.
"""

import pytest

from nutrition_engine.fat_floor import (
    compute_fat_floor,
    apply_fat_floor,
    FatFloorResult,
    FatBreachType,
)


class TestComputeFatFloor:
    def test_current_user_standard(self):
        # 74.2 kg: soft = 0.8 × 74.2 = 59.36 → 59, hard = 0.6 × 74.2 = 44.52 → 45
        result = compute_fat_floor(weight_kg=74.2, mode="standard")
        assert result.soft_floor_g == 59
        assert result.hard_floor_g == 45

    def test_aggressive_mode_same_floors(self):
        # Aggressive mode doesn't loosen fat floors (hormone protection is non-negotiable)
        result = compute_fat_floor(weight_kg=74.2, mode="aggressive")
        assert result.soft_floor_g == 59
        assert result.hard_floor_g == 45

    def test_maintenance_raises_soft_floor(self):
        # Maintenance: fat becomes a target 0.8-1.0, not just floor.
        # Soft floor should be raised to 1.0 (real target) in maintenance.
        result = compute_fat_floor(weight_kg=74.2, mode="maintenance")
        assert result.soft_floor_g == 74  # 1.0 × 74.2 rounded
        assert result.hard_floor_g == 45  # hard stays 0.6

    def test_bulk_allows_higher_fat(self):
        # Bulk: fat 0.8-1.2 g/kg real target range; soft floor stays at 0.8
        result = compute_fat_floor(weight_kg=74.2, mode="bulk")
        assert result.soft_floor_g == 59  # 0.8 g/kg
        assert result.hard_floor_g == 45

    def test_heavy_athlete(self):
        # 90 kg athlete: 72 soft / 54 hard
        result = compute_fat_floor(weight_kg=90.0, mode="standard")
        assert result.soft_floor_g == 72
        assert result.hard_floor_g == 54

    def test_invalid_mode_raises(self):
        with pytest.raises(ValueError):
            compute_fat_floor(weight_kg=74.2, mode="invalid")

    def test_zero_weight_raises(self):
        with pytest.raises(ValueError):
            compute_fat_floor(weight_kg=0, mode="standard")


class TestApplyFatFloor:
    def test_fat_above_soft_no_breach(self):
        result = apply_fat_floor(fat_g=70, weight_kg=74.2, mode="standard")
        assert result.breach_type is FatBreachType.NONE
        assert result.fat_g == 70

    def test_fat_between_soft_and_hard_warning(self):
        # Fat 55g: below soft (59) but above hard (45) → warning, not enforced
        result = apply_fat_floor(fat_g=55, weight_kg=74.2, mode="standard")
        assert result.breach_type is FatBreachType.SOFT
        assert result.fat_g == 55  # keep user value; just warn

    def test_fat_below_hard_raised(self):
        # Fat 40g: below hard (45) → raised to hard floor
        result = apply_fat_floor(fat_g=40, weight_kg=74.2, mode="standard")
        assert result.breach_type is FatBreachType.HARD
        assert result.fat_g == 45

    def test_fat_overshoot_allowed_no_warn(self):
        # Fat 100g on standard: way over soft but NOT flagged (overshoot is safe)
        result = apply_fat_floor(fat_g=100, weight_kg=74.2, mode="standard")
        assert result.breach_type is FatBreachType.NONE

    def test_bulk_mode_overshoot_allowed(self):
        # Bulk mode 120g fat: well above soft 0.8, but bulk allows up to ~1.2 g/kg
        # No breach either way
        result = apply_fat_floor(fat_g=120, weight_kg=74.2, mode="bulk")
        assert result.breach_type is FatBreachType.NONE


class TestCurrentUserScenarios:
    def test_today_fat_58_below_soft_warning(self):
        # User's logged Day 1 had fat at 58.3g (our -800 plan)
        result = apply_fat_floor(fat_g=58, weight_kg=74.2, mode="aggressive")
        # Below soft 59 → SOFT warning
        assert result.breach_type is FatBreachType.SOFT
        assert result.fat_g == 58  # not enforced, just warned

    def test_maintenance_after_target_hit(self):
        # When user reaches 15% BF and switches to maintenance, fat target is 0.8-1.0
        # 70g fat (below 1.0 × 74.2 = 74) → SOFT warning (real target now)
        result = apply_fat_floor(fat_g=70, weight_kg=74.2, mode="maintenance")
        assert result.breach_type is FatBreachType.SOFT
