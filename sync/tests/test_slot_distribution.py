"""Tests for per-slot budget distribution — Task 13."""
import pytest
from nutrition_engine.daily_plan import compute_slot_targets, redistribute_remaining


class TestComputeSlotTargets:
    def test_default_distribution(self):
        targets = compute_slot_targets(calories=2000, protein=176, carbs=250, fat=64, fiber=35)
        assert targets["breakfast"]["calories"] == 500   # 25%
        assert targets["lunch"]["calories"] == 600       # 30%
        assert targets["dinner"]["calories"] == 700      # 35%
        assert targets["pre_sleep"]["calories"] == 200   # 10%
        # Protein distributed proportionally
        assert sum(t["protein"] for t in targets.values()) == 176

    def test_all_macros_distributed(self):
        targets = compute_slot_targets(calories=2000, protein=176, carbs=250, fat=64, fiber=35)
        for macro in ["calories", "protein", "carbs", "fat", "fiber"]:
            total = sum(t[macro] for t in targets.values())
            # Allow rounding error of ±len(ALL_SLOTS)
            expected = {"calories": 2000, "protein": 176, "carbs": 250, "fat": 64, "fiber": 35}[macro]
            assert abs(total - expected) <= 4, f"{macro}: {total} vs {expected}"

    def test_zero_calories(self):
        targets = compute_slot_targets(calories=0, protein=0, carbs=0, fat=0, fiber=0)
        for slot in targets:
            for macro in targets[slot]:
                assert targets[slot][macro] == 0

    def test_all_slots_present(self):
        targets = compute_slot_targets(calories=2000, protein=176, carbs=250, fat=64, fiber=35)
        assert set(targets.keys()) == {"breakfast", "lunch", "dinner", "pre_sleep"}

    def test_dinner_largest(self):
        targets = compute_slot_targets(calories=2000, protein=176, carbs=250, fat=64, fiber=35)
        assert targets["dinner"]["calories"] > targets["lunch"]["calories"]
        assert targets["lunch"]["calories"] > targets["breakfast"]["calories"]
        assert targets["breakfast"]["calories"] > targets["pre_sleep"]["calories"]


class TestRedistributeRemaining:
    def test_after_eating_breakfast(self):
        """After logging 600 kcal breakfast (100 over budget), remaining slots absorb."""
        daily = {"calories": 2000, "protein": 176, "carbs": 250, "fat": 64, "fiber": 35}
        eaten = {"breakfast": {"calories": 600, "protein": 50, "carbs": 60, "fat": 20, "fiber": 8}}
        remaining = redistribute_remaining(daily, eaten)
        # Total remaining = 2000 - 600 = 1400 split among lunch/dinner/pre_sleep
        unfilled_total = remaining["lunch"]["calories"] + remaining["dinner"]["calories"] + remaining["pre_sleep"]["calories"]
        assert unfilled_total == 1400
        # Lunch should still get the largest share of unfilled (dinner is biggest share)
        assert remaining["dinner"]["calories"] > remaining["lunch"]["calories"]
        assert remaining["lunch"]["calories"] > remaining["pre_sleep"]["calories"]

    def test_after_eating_less(self):
        """Eating less at breakfast -> more budget for later slots."""
        daily = {"calories": 2000, "protein": 176, "carbs": 250, "fat": 64, "fiber": 35}
        eaten_less = {"breakfast": {"calories": 300, "protein": 30, "carbs": 30, "fat": 10, "fiber": 5}}
        eaten_more = {"breakfast": {"calories": 600, "protein": 50, "carbs": 60, "fat": 20, "fiber": 8}}
        remaining_less = redistribute_remaining(daily, eaten_less)
        remaining_more = redistribute_remaining(daily, eaten_more)
        assert remaining_less["lunch"]["calories"] > remaining_more["lunch"]["calories"]

    def test_no_meals_eaten_returns_default(self):
        daily = {"calories": 2000, "protein": 176, "carbs": 250, "fat": 64, "fiber": 35}
        remaining = redistribute_remaining(daily, {})
        assert remaining["breakfast"]["calories"] == 500  # default 25%

    def test_all_meals_eaten_preserves_eaten_values(self):
        daily = {"calories": 2000, "protein": 176, "carbs": 250, "fat": 64, "fiber": 35}
        eaten = {
            "breakfast": {"calories": 500, "protein": 44, "carbs": 62, "fat": 16, "fiber": 7},
            "lunch": {"calories": 600, "protein": 44, "carbs": 75, "fat": 19, "fiber": 11},
            "dinner": {"calories": 700, "protein": 56, "carbs": 88, "fat": 22, "fiber": 12},
            "pre_sleep": {"calories": 200, "protein": 32, "carbs": 25, "fat": 7, "fiber": 5},
        }
        remaining = redistribute_remaining(daily, eaten)
        for slot in eaten:
            assert remaining[slot]["calories"] == eaten[slot]["calories"]

    def test_overeating_clamps_remaining_to_zero(self):
        """If total eaten exceeds daily target, remaining should be 0 not negative."""
        daily = {"calories": 2000, "protein": 176, "carbs": 250, "fat": 64, "fiber": 35}
        eaten = {"breakfast": {"calories": 1200, "protein": 100, "carbs": 150, "fat": 40, "fiber": 20},
                 "lunch": {"calories": 1000, "protein": 90, "carbs": 120, "fat": 30, "fiber": 18}}
        remaining = redistribute_remaining(daily, eaten)
        for slot in ["dinner", "pre_sleep"]:
            assert remaining[slot]["calories"] >= 0
            assert remaining[slot]["protein"] >= 0

    def test_protein_redistributes_by_remaining_slot_weights(self):
        """Protein should be split proportionally among unfilled slots."""
        daily = {"calories": 2000, "protein": 176, "carbs": 250, "fat": 64, "fiber": 35}
        eaten = {"breakfast": {"calories": 500, "protein": 44, "carbs": 62, "fat": 16, "fiber": 7}}
        remaining = redistribute_remaining(daily, eaten)
        # Remaining protein = 176 - 44 = 132
        total_remaining_protein = remaining["lunch"]["protein"] + remaining["dinner"]["protein"] + remaining["pre_sleep"]["protein"]
        # Allow rounding error of ±len(unfilled_slots) since each slot rounds independently
        assert abs(total_remaining_protein - 132) <= 3
