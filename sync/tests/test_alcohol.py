"""Tests for nutrition_engine.alcohol — Tasks 6 & 12."""
import pytest

from nutrition_engine.alcohol import (
    compute_alcohol_displacement,
    compute_drink_entry,
    fat_oxidation_pause_hours,
)


class TestComputeDrinkEntry:
    def test_single_ipa(self):
        """1 IPA = ~200 kcal, ~18g alcohol."""
        entry = compute_drink_entry("beer_ipa", quantity=1.0)
        assert entry is not None
        assert entry["drink_type"] == "beer_ipa"
        assert entry["quantity"] == 1.0
        # 355ml * 60 cal/100ml = 213 kcal
        assert 195 <= entry["calories"] <= 220
        # 355ml * 6.5% * 0.789 g/ml = ~18.2g
        assert 16 <= entry["alcohol_grams"] <= 20

    def test_three_ipas_scale(self):
        """3 IPAs should scale linearly."""
        one = compute_drink_entry("beer_ipa", quantity=1.0)
        three = compute_drink_entry("beer_ipa", quantity=3.0)
        assert three is not None
        assert one is not None
        assert three["calories"] == pytest.approx(one["calories"] * 3, abs=1)
        assert three["alcohol_grams"] == pytest.approx(one["alcohol_grams"] * 3, abs=0.5)

    def test_unknown_drink_returns_none(self):
        assert compute_drink_entry("mystery_cocktail") is None

    def test_entry_has_all_fields(self):
        entry = compute_drink_entry("wine_red")
        assert entry is not None
        for field in ["drink_type", "quantity", "calories", "alcohol_grams",
                      "carbs", "fat_oxidation_pause_hours"]:
            assert field in entry, f"Missing field: {field}"

    def test_spirit_entry(self):
        """A neat spirit (45ml, 40% ABV)."""
        entry = compute_drink_entry("spirit")
        assert entry is not None
        # 45ml * 231 cal/100ml = ~104 kcal
        assert 95 <= entry["calories"] <= 115
        # 45ml * 0.40 * 0.789 = ~14.2g
        assert 12 <= entry["alcohol_grams"] <= 16

    def test_zero_quantity(self):
        entry = compute_drink_entry("beer_ipa", quantity=0)
        assert entry is not None
        assert entry["calories"] == 0
        assert entry["alcohol_grams"] == 0

    def test_fractional_quantity(self):
        entry = compute_drink_entry("wine_red", quantity=0.5)
        full = compute_drink_entry("wine_red", quantity=1.0)
        assert entry is not None and full is not None
        assert entry["calories"] == pytest.approx(full["calories"] * 0.5, abs=1)

    def test_carbs_present_for_beer(self):
        entry = compute_drink_entry("beer_regular")
        assert entry is not None
        assert entry["carbs"] > 0

    def test_carbs_zero_for_spirit(self):
        entry = compute_drink_entry("spirit")
        assert entry is not None
        assert entry["carbs"] == 0


class TestFatOxidationPauseHours:
    def test_zero_alcohol(self):
        assert fat_oxidation_pause_hours(0) == 0

    def test_negative_alcohol(self):
        assert fat_oxidation_pause_hours(-5) == 0

    def test_one_drink_range(self):
        """~14g alcohol (1 standard drink) → 4h pause."""
        pause = fat_oxidation_pause_hours(14)
        assert pause == pytest.approx(4, abs=0.5)

    def test_two_drinks_range(self):
        """~28g alcohol (2 drinks) → 6h pause."""
        pause = fat_oxidation_pause_hours(28)
        assert pause == pytest.approx(6, abs=0.5)

    def test_three_drinks_range(self):
        """~42g alcohol (3 drinks) → 8-12h."""
        pause = fat_oxidation_pause_hours(42)
        assert 8 <= pause <= 12

    def test_five_plus_drinks(self):
        """~70g+ alcohol → 12-24h."""
        pause = fat_oxidation_pause_hours(70)
        assert 12 <= pause <= 24

    def test_extreme_alcohol_capped_at_24(self):
        """Very high alcohol → capped at 24h."""
        pause = fat_oxidation_pause_hours(200)
        assert pause == 24

    def test_monotonically_increasing(self):
        """More alcohol should never decrease pause time."""
        prev = 0
        for grams in range(0, 100, 5):
            pause = fat_oxidation_pause_hours(grams)
            assert pause >= prev, f"Decreased at {grams}g: {pause} < {prev}"
            prev = pause

    def test_entry_includes_pause(self):
        """compute_drink_entry includes fat_oxidation_pause_hours field."""
        entry = compute_drink_entry("beer_ipa", quantity=3.0)
        assert entry is not None
        assert entry["fat_oxidation_pause_hours"] > 0
        # 3 IPAs ~ 54g alcohol → should be 8-12h range
        assert 8 <= entry["fat_oxidation_pause_hours"] <= 14


class TestAlcoholDisplacement:
    def test_macro_displacement_basic(self):
        result = compute_alcohol_displacement(
            alcohol_calories=600, remaining_fat_g=64, remaining_carbs_g=200
        )
        assert result["fat_reduction_g"] > 0
        assert result["carbs_reduction_g"] > 0
        assert result["protein_reduction_g"] == 0
        # 60-70% from fat
        fat_kcal_reduced = result["fat_reduction_g"] * 9
        assert 0.55 * 600 <= fat_kcal_reduced <= 0.75 * 600

    def test_displacement_never_touches_protein(self):
        result = compute_alcohol_displacement(600, 20, 50)  # low remaining macros
        assert result["protein_reduction_g"] == 0

    def test_zero_alcohol_returns_zero_displacement(self):
        result = compute_alcohol_displacement(0, 64, 200)
        assert result["fat_reduction_g"] == 0
        assert result["carbs_reduction_g"] == 0
        assert result["protein_reduction_g"] == 0

    def test_fat_displacement_capped_at_remaining(self):
        """Fat reduction can't exceed remaining fat budget."""
        result = compute_alcohol_displacement(
            alcohol_calories=600, remaining_fat_g=10, remaining_carbs_g=200
        )
        assert result["fat_reduction_g"] <= 10

    def test_carbs_displacement_capped_at_remaining(self):
        """Carbs reduction can't exceed remaining carbs budget."""
        result = compute_alcohol_displacement(
            alcohol_calories=600, remaining_fat_g=100, remaining_carbs_g=5
        )
        assert result["carbs_reduction_g"] <= 5

    def test_low_fat_budget_shifts_to_carbs(self):
        """When fat budget is low, excess displacement shifts to carbs."""
        # With only 5g fat remaining (45 kcal from fat), most of 600 kcal
        # displacement must come from carbs
        result = compute_alcohol_displacement(
            alcohol_calories=600, remaining_fat_g=5, remaining_carbs_g=200
        )
        assert result["fat_reduction_g"] <= 5
        # The carbs reduction should pick up the slack
        assert result["carbs_reduction_g"] > 0
        total_displaced = result["fat_reduction_g"] * 9 + result["carbs_reduction_g"] * 4
        # Should displace close to 600 kcal total (within rounding)
        assert total_displaced == pytest.approx(600, abs=1)

    def test_result_contains_all_expected_keys(self):
        result = compute_alcohol_displacement(300, 50, 100)
        assert "fat_reduction_g" in result
        assert "carbs_reduction_g" in result
        assert "protein_reduction_g" in result
