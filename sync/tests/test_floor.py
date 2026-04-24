"""Tests for BMR + RED-S EA floor enforcement (M1.3)."""

import pytest

from nutrition_engine.floor import (
    compute_floor,
    apply_floor,
    FloorResult,
    FloorBreachType,
    REDS_EA_COEFFICIENT,
)
from nutrition_engine.tier import Tier


class TestComputeFloor:
    """Compute soft + hard floors given FFM, exercise, and mode."""

    def test_standard_rest_day_current_user(self):
        # User: FFM 60.6, no exercise, Standard mode
        # soft = Cunningham = 1833
        # hard = max(Cunningham, 25 × 60.6 + 0) = max(1833, 1515) = 1833
        result = compute_floor(ffm_kg=60.6, exercise_kcal=0, mode="standard")
        assert result.soft_floor == 1833
        assert result.hard_floor == 1833

    def test_standard_training_day_current_user(self):
        # User: FFM 60.6, 400 kcal exercise
        # soft = Cunningham = 1833
        # hard = max(Cunningham, 25 × 60.6 + 400) = max(1833, 1915) = 1915
        result = compute_floor(ffm_kg=60.6, exercise_kcal=400, mode="standard")
        assert result.soft_floor == 1833
        assert result.hard_floor == 1915

    def test_aggressive_mode_drops_cunningham(self):
        # Aggressive mode: hard = 25×FFM + exercise (no Cunningham gate)
        # User rest day: hard = 25 × 60.6 + 0 = 1515
        result = compute_floor(ffm_kg=60.6, exercise_kcal=0, mode="aggressive")
        assert result.hard_floor == 1515
        # Soft floor still shown for awareness but not enforced
        assert result.soft_floor == 1833

    def test_aggressive_mode_training_day(self):
        # User training day 400 kcal exercise
        # hard = 25 × 60.6 + 400 = 1915 (in aggressive)
        result = compute_floor(ffm_kg=60.6, exercise_kcal=400, mode="aggressive")
        assert result.hard_floor == 1915

    def test_high_ffm_user(self):
        # Big athlete, FFM 80 kg
        # Cunningham = 500 + 22×80 = 2260
        # EA = 25 × 80 = 2000
        # Standard: hard = max(2260, 2000) = 2260 (Cunningham dominates)
        result = compute_floor(ffm_kg=80.0, exercise_kcal=0, mode="standard")
        assert result.soft_floor == 2260
        assert result.hard_floor == 2260

    def test_low_ffm_ea_dominates(self):
        # Light user, FFM 45 kg
        # Cunningham = 500 + 22×45 = 1490
        # EA = 25 × 45 = 1125
        # With 500 kcal exercise: EA becomes 1625 > Cunningham 1490
        result = compute_floor(ffm_kg=45.0, exercise_kcal=500, mode="standard")
        assert result.hard_floor == 1625  # EA dominates

    def test_invalid_mode_raises(self):
        with pytest.raises(ValueError):
            compute_floor(ffm_kg=60.6, exercise_kcal=0, mode="invalid")

    def test_negative_exercise_raises(self):
        with pytest.raises(ValueError):
            compute_floor(ffm_kg=60.6, exercise_kcal=-100, mode="standard")

    def test_zero_ffm_raises(self):
        with pytest.raises(ValueError):
            compute_floor(ffm_kg=0, exercise_kcal=0, mode="standard")


class TestApplyFloor:
    """Apply floor to a proposed target_kcal and return adjusted + breach type."""

    def test_target_above_both_floors_no_breach(self):
        # User rest day: floors 1833/1833
        result = apply_floor(target_kcal=2000, ffm_kg=60.6, exercise_kcal=0, mode="standard")
        assert result.target_kcal == 2000
        assert result.breach_type is FloorBreachType.NONE

    def test_target_below_soft_floor_warning(self):
        # Target 1800 < soft 1833, but 1800 = hard floor in this case
        # Standard mode rest: soft=hard=1833, so target 1800 = hard breach
        result = apply_floor(target_kcal=1800, ffm_kg=60.6, exercise_kcal=0, mode="standard")
        assert result.breach_type is FloorBreachType.HARD
        assert result.target_kcal == 1833  # raised to hard floor

    def test_target_below_hard_floor_raised(self):
        # User training day: hard floor 1915; target 1700 breaches it
        result = apply_floor(target_kcal=1700, ffm_kg=60.6, exercise_kcal=400, mode="standard")
        assert result.breach_type is FloorBreachType.HARD
        assert result.target_kcal == 1915  # raised to hard floor

    def test_aggressive_allows_below_cunningham(self):
        # Aggressive rest day: hard = 25×FFM = 1515
        # Target 1600 is below Cunningham (1833) but above EA hard (1515)
        # In Aggressive mode, this is SOFT breach (warning) not HARD (enforced)
        result = apply_floor(target_kcal=1600, ffm_kg=60.6, exercise_kcal=0, mode="aggressive")
        assert result.breach_type is FloorBreachType.SOFT
        assert result.target_kcal == 1600  # not raised (below Cunningham but OK in Aggressive)

    def test_aggressive_hard_floor_enforced(self):
        # Aggressive rest day: hard=1515. Target 1400 breaches hard.
        result = apply_floor(target_kcal=1400, ffm_kg=60.6, exercise_kcal=0, mode="aggressive")
        assert result.breach_type is FloorBreachType.HARD
        assert result.target_kcal == 1515

    def test_reds_coefficient_constant(self):
        # Regression guard — the RED-S EA coefficient must be 25 kcal/kg FFM per V11
        # (Mountjoy 2018 threshold)
        assert REDS_EA_COEFFICIENT == 25


class TestCurrentUserScenarios:
    """Live scenarios matching brainstorming decisions for current user."""

    def test_current_1732_target_breaches_soft_floor_on_rest_day(self):
        # Current soma plan: 1732 kcal target on rest day
        # In Standard mode this breaches Cunningham floor (1833) -> 100 kcal below
        result = apply_floor(target_kcal=1732, ffm_kg=60.6, exercise_kcal=0, mode="standard")
        assert result.breach_type is FloorBreachType.HARD  # soft=hard=1833
        assert result.target_kcal == 1833

    def test_current_1732_target_breaches_hard_floor_on_training_day(self):
        # 1732 target with 400 kcal training: hard floor 1915 is breached by 183 kcal
        result = apply_floor(target_kcal=1732, ffm_kg=60.6, exercise_kcal=400, mode="standard")
        assert result.breach_type is FloorBreachType.HARD
        assert result.target_kcal == 1915

    def test_max_deficit_rest_day_standard(self):
        # With TDEE 2547 (standard day) and floor 1833, max deficit = 714
        tdee = 2547
        floor = compute_floor(ffm_kg=60.6, exercise_kcal=0, mode="standard")
        max_deficit = tdee - floor.hard_floor
        assert max_deficit == 714

    def test_max_deficit_training_day_standard(self):
        # With TDEE 2547 (400 kcal exercise included) and hard floor 1915, max deficit = 632
        tdee = 2547
        floor = compute_floor(ffm_kg=60.6, exercise_kcal=400, mode="standard")
        max_deficit = tdee - floor.hard_floor
        assert max_deficit == 632
