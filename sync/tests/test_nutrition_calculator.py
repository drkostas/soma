"""Tests for nutrition_engine.calculator — Task 3."""
import pytest

from nutrition_engine.calculator import compute_meal_macros, compute_preset_totals
from nutrition_engine.seed_data import INGREDIENTS, PRESET_MEALS


class TestComputeMealMacros:
    def test_single_ingredient_100g_chicken(self):
        items = [{"ingredient_id": "chicken_breast_raw", "grams": 100}]
        result = compute_meal_macros(items, INGREDIENTS)
        assert result["calories"] == pytest.approx(120, abs=0.1)
        assert result["protein"] == pytest.approx(22.5, abs=0.1)
        assert result["carbs"] == pytest.approx(0, abs=0.1)
        assert result["fat"] == pytest.approx(2.6, abs=0.1)
        assert result["fiber"] == pytest.approx(0, abs=0.1)

    def test_multiple_ingredients_sum(self):
        items = [
            {"ingredient_id": "chicken_breast_raw", "grams": 200},  # 240 kcal
            {"ingredient_id": "white_rice_raw", "grams": 100},      # 365 kcal
            {"ingredient_id": "olive_oil", "grams": 10},            # 88.4 kcal
        ]
        result = compute_meal_macros(items, INGREDIENTS)
        expected_cal = 200 * 120 / 100 + 100 * 365 / 100 + 10 * 884 / 100
        assert result["calories"] == pytest.approx(expected_cal, abs=0.1)

        expected_protein = 200 * 22.5 / 100 + 100 * 7.1 / 100 + 0
        assert result["protein"] == pytest.approx(expected_protein, abs=0.1)

    def test_multiplier_scales_all_values(self):
        items = [{"ingredient_id": "eggs_whole", "grams": 100}]
        base = compute_meal_macros(items, INGREDIENTS, multiplier=1.0)
        doubled = compute_meal_macros(items, INGREDIENTS, multiplier=2.0)

        assert doubled["calories"] == pytest.approx(base["calories"] * 2, abs=0.1)
        assert doubled["protein"] == pytest.approx(base["protein"] * 2, abs=0.1)
        assert doubled["carbs"] == pytest.approx(base["carbs"] * 2, abs=0.1)
        assert doubled["fat"] == pytest.approx(base["fat"] * 2, abs=0.1)
        assert doubled["fiber"] == pytest.approx(base["fiber"] * 2, abs=0.1)

    def test_half_multiplier(self):
        items = [{"ingredient_id": "banana", "grams": 120}]
        base = compute_meal_macros(items, INGREDIENTS, multiplier=1.0)
        half = compute_meal_macros(items, INGREDIENTS, multiplier=0.5)
        assert half["calories"] == pytest.approx(base["calories"] * 0.5, abs=0.1)

    def test_result_includes_items_breakdown(self):
        items = [
            {"ingredient_id": "chicken_breast_raw", "grams": 200},
            {"ingredient_id": "broccoli_raw", "grams": 150},
        ]
        result = compute_meal_macros(items, INGREDIENTS)

        assert "items" in result
        assert len(result["items"]) == 2

        chicken_item = result["items"][0]
        assert chicken_item["name"] == "Chicken Breast (raw)"
        assert chicken_item["grams"] == 200
        assert chicken_item["calories"] == pytest.approx(240, abs=0.1)
        assert chicken_item["protein"] == pytest.approx(45, abs=0.1)

        broccoli_item = result["items"][1]
        assert broccoli_item["name"] == "Broccoli (raw)"
        assert broccoli_item["grams"] == 150

    def test_empty_items_returns_zeros(self):
        result = compute_meal_macros([], INGREDIENTS)
        assert result["calories"] == 0
        assert result["protein"] == 0
        assert result["carbs"] == 0
        assert result["fat"] == 0
        assert result["fiber"] == 0
        assert result["items"] == []

    def test_unknown_ingredient_raises(self):
        items = [{"ingredient_id": "mystery_food", "grams": 100}]
        with pytest.raises(KeyError):
            compute_meal_macros(items, INGREDIENTS)


class TestComputePresetTotals:
    def test_returns_dict_of_presets(self):
        totals = compute_preset_totals(PRESET_MEALS, INGREDIENTS)
        assert isinstance(totals, dict)
        assert len(totals) == len(PRESET_MEALS)

    def test_all_presets_have_positive_calories(self):
        totals = compute_preset_totals(PRESET_MEALS, INGREDIENTS)
        for name, macros in totals.items():
            assert macros["calories"] > 0, (
                f"Preset '{name}' has non-positive calories: {macros['calories']}"
            )

    def test_preset_has_all_macro_fields(self):
        totals = compute_preset_totals(PRESET_MEALS, INGREDIENTS)
        required = ["calories", "protein", "carbs", "fat", "fiber"]
        for name, macros in totals.items():
            for field in required:
                assert field in macros, (
                    f"Preset '{name}' missing field '{field}'"
                )

    def test_chicken_rice_bowl_sanity(self):
        """Chicken rice bowl should be roughly 500-700 kcal (150g chicken, 80g rice)."""
        totals = compute_preset_totals(PRESET_MEALS, INGREDIENTS)
        bowl = totals["chicken_rice_bowl"]
        assert 450 <= bowl["calories"] <= 700
        assert bowl["protein"] > 30  # 150g chicken = ~34g protein
