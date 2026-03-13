"""Tests for nutrition_engine.tdee — Tasks 4 & 7."""
import pytest

from nutrition_engine.tdee import (
    bootstrap_tdee,
    compute_macro_targets,
    CARB_TARGETS_G_PER_KG,
    MAX_DEFICIT,
    REDS_FLOOR,
)


class TestBootstrapTdee:
    def test_basic_tdee(self):
        assert bootstrap_tdee(1700, 800) == 2300

    def test_zero_active_cal(self):
        assert bootstrap_tdee(1700, 0) == 1700

    def test_scaling_factor(self):
        # 800 * 0.75 = 600, so BMR + 600 = 2300
        assert bootstrap_tdee(1700, 800) == 1700 + 800 * 0.75

    def test_low_active_cal(self):
        assert bootstrap_tdee(1500, 200) == 1500 + 200 * 0.75


class TestComputeMacroTargets:
    def test_rest_day_macros(self):
        """Rest day: 2300 TDEE - 400 deficit + 0 exercise = 1900, 80kg."""
        result = compute_macro_targets(
            tdee=2300,
            deficit=400,
            weight_kg=80,
            exercise_calories=0,
            training_day_type="rest",
        )
        assert result["calories"] == 1900
        assert result["protein"] == 176   # 80 * 2.2 = 176
        assert result["fat"] == 64        # 80 * 0.8 = 64
        # Carbs = (1900 - 176*4 - 64*9) / 4
        expected_carbs = (1900 - 176 * 4 - 64 * 9) / 4
        assert result["carbs"] == round(expected_carbs)
        assert result["fiber"] == 35

    def test_exercise_calories_more_carbs_than_rest(self):
        """Day with exercise calories should have more carbs than rest day."""
        rest = compute_macro_targets(
            tdee=2300, deficit=400, weight_kg=80, exercise_calories=0,
        )
        active = compute_macro_targets(
            tdee=2300, deficit=400, weight_kg=80, exercise_calories=500,
        )
        assert active["carbs"] > rest["carbs"]
        assert active["calories"] > rest["calories"]

    def test_deficit_capped_at_500(self):
        """Input deficit 700 should be capped at 500."""
        result = compute_macro_targets(
            tdee=2300, deficit=700, weight_kg=80,
        )
        # With 500 cap: 2300 - 500 + 0 = 1800
        assert result["calories"] == 1800

    def test_reds_floor_enforced(self):
        """RED-S floor: 25 kcal/kg FFM. 65kg FFM = 1625 minimum."""
        result = compute_macro_targets(
            tdee=2000,
            deficit=500,
            weight_kg=80,
            ffm_kg=65,
        )
        # Without floor: 2000 - 500 + 0 = 1500 < 1625
        assert result["calories"] >= 1625

    def test_reds_floor_not_applied_when_above(self):
        """If calories already above RED-S floor, no change."""
        result = compute_macro_targets(
            tdee=2500,
            deficit=400,
            weight_kg=80,
            ffm_kg=65,
        )
        # Without floor: 2500 - 400 = 2100 > 1625
        assert result["calories"] == 2100

    def test_exercise_calories_added(self):
        """Exercise calories are added to TDEE before deficit."""
        result = compute_macro_targets(
            tdee=2300, deficit=0, weight_kg=80, exercise_calories=300,
        )
        assert result["calories"] == 2600  # 2300 + 300

    def test_exercise_calories_default_zero(self):
        """Default exercise_calories is 0."""
        result = compute_macro_targets(
            tdee=2300, deficit=0, weight_kg=80,
        )
        assert result["calories"] == 2300

    def test_custom_protein_per_kg(self):
        result = compute_macro_targets(
            tdee=2300, deficit=0, weight_kg=80,
            protein_g_per_kg=1.8,
        )
        assert result["protein"] == round(80 * 1.8)

    def test_custom_fat_per_kg(self):
        result = compute_macro_targets(
            tdee=2300, deficit=0, weight_kg=80,
            fat_g_per_kg=1.0,
        )
        assert result["fat"] == round(80 * 1.0)

    def test_zero_deficit(self):
        result = compute_macro_targets(
            tdee=2300, deficit=0, weight_kg=80,
        )
        assert result["calories"] == 2300

    def test_negative_carbs_floor_at_zero(self):
        """If protein + fat exceed calories, carbs should not go negative."""
        # Extreme case: very low TDEE, high protein/fat targets
        result = compute_macro_targets(
            tdee=1200, deficit=0, weight_kg=100,
            protein_g_per_kg=2.5, fat_g_per_kg=1.5,
        )
        assert result["carbs"] >= 0

    def test_result_has_all_fields(self):
        result = compute_macro_targets(
            tdee=2300, deficit=400, weight_kg=80,
        )
        for field in ["calories", "protein", "carbs", "fat", "fiber"]:
            assert field in result, f"Missing field: {field}"


class TestConstants:
    def test_max_deficit(self):
        assert MAX_DEFICIT == 500

    def test_reds_floor(self):
        assert REDS_FLOOR == 25

    def test_carb_targets_keys(self):
        expected = {"rest", "easy_run", "hard_run", "long_run", "gym", "gym_and_run"}
        assert set(CARB_TARGETS_G_PER_KG.keys()) == expected
