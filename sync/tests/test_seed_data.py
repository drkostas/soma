"""Tests for nutrition_engine.seed_data — Task 2."""
import pytest

from nutrition_engine.seed_data import INGREDIENTS, PRESET_MEALS, DRINK_DATABASE


# --- Ingredient tests ---

REQUIRED_INGREDIENT_FIELDS = [
    "name",
    "calories_per_100g",
    "protein_per_100g",
    "carbs_per_100g",
    "fat_per_100g",
    "fiber_per_100g",
    "is_raw",
    "raw_to_cooked_ratio",
    "category",
]


class TestIngredients:
    def test_minimum_count(self):
        assert len(INGREDIENTS) >= 20

    def test_required_fields(self):
        for ing_id, ing in INGREDIENTS.items():
            for field in REQUIRED_INGREDIENT_FIELDS:
                assert field in ing, (
                    f"Ingredient '{ing_id}' missing field '{field}'"
                )

    def test_calorie_consistency(self):
        """Calories should be within 20% of 4*P + 4*C + 9*F.

        Uses a wider 30% tolerance for high-fiber vegetables where
        Atwater factors overestimate due to lower bioavailability.
        """
        for ing_id, ing in INGREDIENTS.items():
            computed = (
                4 * ing["protein_per_100g"]
                + 4 * ing["carbs_per_100g"]
                + 9 * ing["fat_per_100g"]
            )
            listed = ing["calories_per_100g"]
            if listed == 0:
                continue
            # High-fiber vegetables deviate from Atwater (fiber kcal ~2 not 4)
            tol = 0.3 if ing["category"] == "vegetable" else 0.2
            ratio = computed / listed
            assert (1 - tol) <= ratio <= (1 + tol), (
                f"Ingredient '{ing_id}': listed {listed} kcal but computed "
                f"{computed:.1f} kcal (ratio={ratio:.2f}, tol={tol})"
            )

    def test_no_negative_values(self):
        numeric_fields = [
            "calories_per_100g",
            "protein_per_100g",
            "carbs_per_100g",
            "fat_per_100g",
            "fiber_per_100g",
        ]
        for ing_id, ing in INGREDIENTS.items():
            for field in numeric_fields:
                assert ing[field] >= 0, (
                    f"Ingredient '{ing_id}' has negative {field}: {ing[field]}"
                )

    def test_raw_ingredients_have_ratio(self):
        for ing_id, ing in INGREDIENTS.items():
            if ing["is_raw"]:
                assert ing["raw_to_cooked_ratio"] is not None, (
                    f"Raw ingredient '{ing_id}' missing raw_to_cooked_ratio"
                )
                assert ing["raw_to_cooked_ratio"] > 0


# --- Preset meal tests ---

REQUIRED_PRESET_FIELDS = ["name", "items"]


class TestPresetMeals:
    def test_minimum_count(self):
        assert len(PRESET_MEALS) >= 8

    def test_required_fields(self):
        for preset_id, preset in PRESET_MEALS.items():
            for field in REQUIRED_PRESET_FIELDS:
                assert field in preset, (
                    f"Preset '{preset_id}' missing field '{field}'"
                )

    def test_items_are_lists(self):
        for preset_id, preset in PRESET_MEALS.items():
            assert isinstance(preset["items"], list), (
                f"Preset '{preset_id}' items should be a list"
            )
            assert len(preset["items"]) > 0, (
                f"Preset '{preset_id}' has empty items"
            )

    def test_all_ingredient_references_valid(self):
        """Every item in a preset must reference a known ingredient."""
        for preset_id, preset in PRESET_MEALS.items():
            for item in preset["items"]:
                assert "ingredient_id" in item, (
                    f"Preset '{preset_id}' item missing 'ingredient_id'"
                )
                assert "grams" in item, (
                    f"Preset '{preset_id}' item missing 'grams'"
                )
                assert item["ingredient_id"] in INGREDIENTS, (
                    f"Preset '{preset_id}' references unknown ingredient "
                    f"'{item['ingredient_id']}'"
                )

    def test_item_grams_positive(self):
        for preset_id, preset in PRESET_MEALS.items():
            for item in preset["items"]:
                assert item["grams"] > 0, (
                    f"Preset '{preset_id}' has item with non-positive grams"
                )


# --- Drink database tests ---

REQUIRED_DRINK_FIELDS = [
    "name",
    "calories_per_100ml",
    "carbs_per_100ml",
    "alcohol_pct",
    "default_ml",
]


class TestDrinkDatabase:
    def test_minimum_count(self):
        assert len(DRINK_DATABASE) >= 9

    def test_required_fields(self):
        for drink_id, drink in DRINK_DATABASE.items():
            for field in REQUIRED_DRINK_FIELDS:
                assert field in drink, (
                    f"Drink '{drink_id}' missing field '{field}'"
                )

    def test_no_negative_values(self):
        for drink_id, drink in DRINK_DATABASE.items():
            assert drink["calories_per_100ml"] >= 0
            assert drink["carbs_per_100ml"] >= 0
            assert drink["alcohol_pct"] >= 0
            assert drink["default_ml"] > 0
