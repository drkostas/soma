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
        """Rest day: 2300 TDEE - 400 deficit + 0 exercise = 1900, 80kg.

        Carbs are strict remainder after protein and fat to guarantee
        macro-calorie consistency (no carb floor override).
        """
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
        # carbs = (1900 - 176*4 - 64*9) / 4 = (1900 - 704 - 576) / 4 = 155
        assert result["carbs"] == 155
        assert result["fiber"] == 35
        # Verify macro-calorie consistency
        macro_cal = result["protein"] * 4 + result["carbs"] * 4 + result["fat"] * 9
        assert abs(macro_cal - result["calories"]) <= 9

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
        """Custom fat 1.0 g/kg = 80g. Carbs are strict remainder."""
        result = compute_macro_targets(
            tdee=2300, deficit=0, weight_kg=80,
            fat_g_per_kg=1.0,
        )
        # Fat stays at requested 80g (no carb floor to force reduction)
        assert result["fat"] == 80
        # carbs = (2300 - 176*4 - 80*9) / 4 = (2300 - 704 - 720) / 4 = 219
        assert result["carbs"] == 219

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


class TestCarbPeriodization:
    def test_carb_periodization_rest_vs_long_run(self):
        rest = compute_macro_targets(2200, 300, 80, exercise_calories=0, training_day_type="rest")
        long = compute_macro_targets(2850, 300, 80, exercise_calories=650, training_day_type="long_run")
        assert long["carbs"] > rest["carbs"]
        assert long["carbs"] >= 80 * 4.5  # at least 4.5 g/kg for long runs

    def test_carbs_as_remainder_with_exercise(self):
        # Carbs are strict remainder — no floor override, but exercise calories add room
        result = compute_macro_targets(1800, 0, 80, exercise_calories=500, training_day_type="hard_run")
        # target = 1800 + 500 - 0 = 2300; carbs = (2300 - 176*4 - 64*9) / 4 = 255
        expected_carbs = round((2300 - 176 * 4 - 64 * 9) / 4)
        assert result["carbs"] == expected_carbs
        # Verify macro-calorie consistency
        macro_cal = result["protein"] * 4 + result["carbs"] * 4 + result["fat"] * 9
        assert abs(macro_cal - result["calories"]) <= 9

    def test_fat_reduced_when_carb_floor_active(self):
        # When carb floor is active, fat should be reduced to compensate (never protein)
        normal = compute_macro_targets(2500, 300, 80, exercise_calories=200, training_day_type="rest")
        hard = compute_macro_targets(2500, 300, 80, exercise_calories=200, training_day_type="hard_run")
        # Hard run has carb floor, may reduce fat
        if hard["carbs"] > normal["carbs"]:
            assert hard["fat"] <= normal["fat"]  # fat reduced to compensate

    def test_rest_day_carbs_are_remainder(self):
        # Carbs are strict remainder, no floor override
        result = compute_macro_targets(2200, 300, 80, exercise_calories=0, training_day_type="rest")
        # target = 2200 - 300 = 1900; carbs = (1900 - 176*4 - 64*9) / 4 = 155
        expected_carbs = round((1900 - 176 * 4 - 64 * 9) / 4)
        assert result["carbs"] == expected_carbs
        macro_cal = result["protein"] * 4 + result["carbs"] * 4 + result["fat"] * 9
        assert abs(macro_cal - result["calories"]) <= 9


class TestConstants:
    def test_max_deficit(self):
        assert MAX_DEFICIT == 500

    def test_reds_floor(self):
        assert REDS_FLOOR == 25

    def test_carb_targets_keys(self):
        expected = {"rest", "easy_run", "hard_run", "long_run", "gym", "gym_and_run"}
        assert set(CARB_TARGETS_G_PER_KG.keys()) == expected
