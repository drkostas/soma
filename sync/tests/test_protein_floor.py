"""Tests for protein floor warning (M1.6).

Research basis: Morton 2018 meta plateau at 1.6 g/kg for RT-induced FFM.
Below floor for 3+ consecutive days → amber warning banner.
Also V9.1 per-meal thresholds (25g red / 30g green).
"""

import pytest

from nutrition_engine.protein_floor import (
    compute_protein_floor,
    check_protein_floor,
    check_per_meal_protein,
    ProteinFloorStatus,
    PerMealProteinLevel,
)


class TestComputeProteinFloor:
    def test_current_user(self):
        # 74.2 kg × 1.6 = 118.72 → 119
        assert compute_protein_floor(weight_kg=74.2) == 119

    def test_heavy_athlete(self):
        assert compute_protein_floor(weight_kg=90.0) == 144

    def test_zero_weight_raises(self):
        with pytest.raises(ValueError):
            compute_protein_floor(weight_kg=0)


class TestCheckProteinFloor:
    def test_all_above_floor_green(self):
        # 5 days all above 119g floor for 74.2 kg user
        recent_intakes = [150, 145, 160, 155, 140]
        result = check_protein_floor(recent_intakes=recent_intakes, weight_kg=74.2)
        assert result.status is ProteinFloorStatus.GREEN
        assert result.days_below_floor == 0

    def test_one_day_below_no_warning(self):
        # Only 1 day below — banner not yet active (requires 3+ consecutive)
        recent_intakes = [150, 145, 100, 155, 140]  # day 3 below
        result = check_protein_floor(recent_intakes=recent_intakes, weight_kg=74.2)
        assert result.status is ProteinFloorStatus.GREEN
        assert result.days_below_floor == 0  # streak broken

    def test_two_consecutive_below_no_warning(self):
        # 2 consecutive days below — banner not yet active (needs 3+)
        recent_intakes = [150, 145, 100, 90, 140]
        result = check_protein_floor(recent_intakes=recent_intakes, weight_kg=74.2)
        assert result.status is ProteinFloorStatus.GREEN
        assert result.days_below_floor == 0  # streak broken by day 5

    def test_three_consecutive_below_amber(self):
        # 3 consecutive days below — banner fires
        recent_intakes = [150, 145, 100, 90, 80]  # days 3,4,5 below
        result = check_protein_floor(recent_intakes=recent_intakes, weight_kg=74.2)
        assert result.status is ProteinFloorStatus.AMBER
        assert result.days_below_floor == 3

    def test_five_consecutive_below_amber_streak_counted(self):
        recent_intakes = [100, 95, 110, 105, 115]  # all below 119
        result = check_protein_floor(recent_intakes=recent_intakes, weight_kg=74.2)
        assert result.status is ProteinFloorStatus.AMBER
        assert result.days_below_floor == 5

    def test_single_good_day_breaks_streak(self):
        # 2 below, 1 good, 3 below → streak is 3 (last 3 days)
        recent_intakes = [100, 90, 150, 80, 85, 90]
        result = check_protein_floor(recent_intakes=recent_intakes, weight_kg=74.2)
        assert result.status is ProteinFloorStatus.AMBER
        assert result.days_below_floor == 3  # last 3 days

    def test_empty_history(self):
        result = check_protein_floor(recent_intakes=[], weight_kg=74.2)
        assert result.status is ProteinFloorStatus.GREEN
        assert result.days_below_floor == 0

    def test_exactly_at_floor_not_below(self):
        # Exactly at 119g = not below
        recent_intakes = [119, 119, 119]
        result = check_protein_floor(recent_intakes=recent_intakes, weight_kg=74.2)
        assert result.status is ProteinFloorStatus.GREEN


class TestPerMealProtein:
    """V9.1 per-meal thresholds for MPS quality signaling."""

    def test_below_15g_red(self):
        assert check_per_meal_protein(10) is PerMealProteinLevel.RED
        assert check_per_meal_protein(14) is PerMealProteinLevel.RED

    def test_15_to_24_amber(self):
        assert check_per_meal_protein(15) is PerMealProteinLevel.AMBER
        assert check_per_meal_protein(20) is PerMealProteinLevel.AMBER
        assert check_per_meal_protein(24) is PerMealProteinLevel.AMBER

    def test_25_to_29_yellow(self):
        assert check_per_meal_protein(25) is PerMealProteinLevel.YELLOW
        assert check_per_meal_protein(29) is PerMealProteinLevel.YELLOW

    def test_30_to_55_green(self):
        assert check_per_meal_protein(30) is PerMealProteinLevel.GREEN
        assert check_per_meal_protein(40) is PerMealProteinLevel.GREEN
        assert check_per_meal_protein(55) is PerMealProteinLevel.GREEN

    def test_above_55_no_warning(self):
        # Trommelen 2023 killed the 40g ceiling — no warning on large doses
        assert check_per_meal_protein(60) is PerMealProteinLevel.NO_WARNING
        assert check_per_meal_protein(100) is PerMealProteinLevel.NO_WARNING
