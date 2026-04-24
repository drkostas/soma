"""Tests for per-slot kcal pacing.

After #81 (collapse per-meal budget to kcal-only), slot targets only allocate
kcal. Protein / carbs / fat / fiber are day-level targets, not per-slot, so
the functions no longer split them. The tests below enforce that shape.
"""
import pytest
from nutrition_engine.daily_plan import compute_slot_targets, redistribute_remaining


class TestComputeSlotTargets:
    def test_default_distribution(self):
        targets = compute_slot_targets(calories=2000)
        assert targets["breakfast"]["calories"] == 560   # 28%
        assert targets["lunch"]["calories"] == 500       # 25%
        assert targets["dinner"]["calories"] == 740      # 37%
        assert targets["pre_sleep"]["calories"] == 200   # 10%

    def test_only_calories_key(self):
        targets = compute_slot_targets(calories=2000)
        for slot, macros in targets.items():
            assert set(macros.keys()) == {"calories"}, (
                f"{slot} has non-kcal keys — per-slot P/C/F/Fi is the bug #81 fixed"
            )

    def test_zero_calories(self):
        targets = compute_slot_targets(calories=0)
        for slot in targets:
            assert targets[slot]["calories"] == 0

    def test_all_slots_present(self):
        targets = compute_slot_targets(calories=2000)
        assert set(targets.keys()) == {"breakfast", "lunch", "dinner", "pre_sleep"}

    def test_dinner_largest(self):
        targets = compute_slot_targets(calories=2000)
        assert targets["dinner"]["calories"] > targets["breakfast"]["calories"]
        assert targets["breakfast"]["calories"] > targets["lunch"]["calories"]
        assert targets["lunch"]["calories"] > targets["pre_sleep"]["calories"]


class TestRedistributeRemaining:
    def test_after_eating_breakfast_absorbs_remainder(self):
        """After logging 600 kcal breakfast, the other three slots absorb 1400 kcal."""
        remaining = redistribute_remaining(2000, {"breakfast": 600})
        unfilled_total = (
            remaining["lunch"]["calories"]
            + remaining["dinner"]["calories"]
            + remaining["pre_sleep"]["calories"]
        )
        assert abs(unfilled_total - 1400) <= 2  # rounding tolerance
        assert remaining["dinner"]["calories"] > remaining["lunch"]["calories"]
        assert remaining["lunch"]["calories"] > remaining["pre_sleep"]["calories"]

    def test_eating_less_leaves_more_for_later(self):
        less = redistribute_remaining(2000, {"breakfast": 300})
        more = redistribute_remaining(2000, {"breakfast": 600})
        assert less["lunch"]["calories"] > more["lunch"]["calories"]

    def test_no_meals_eaten_returns_default_distribution(self):
        remaining = redistribute_remaining(2000, {})
        assert remaining["breakfast"]["calories"] == 560  # 28%
        assert remaining["pre_sleep"]["calories"] == 200  # 10%

    def test_all_meals_eaten_preserves_eaten_values(self):
        eaten = {"breakfast": 500, "lunch": 600, "dinner": 700, "pre_sleep": 200}
        remaining = redistribute_remaining(2000, eaten)
        for slot, kcal in eaten.items():
            assert remaining[slot]["calories"] == kcal

    def test_overeating_clamps_remaining_to_zero(self):
        eaten = {"breakfast": 1200, "lunch": 1000}
        remaining = redistribute_remaining(2000, eaten)
        for slot in ["dinner", "pre_sleep"]:
            assert remaining[slot]["calories"] == 0

    def test_result_has_only_calories_key(self):
        """The shape invariant: no protein/carbs/fat/fiber keys in the output."""
        remaining = redistribute_remaining(2000, {"breakfast": 500})
        for slot, macros in remaining.items():
            assert set(macros.keys()) == {"calories"}, (
                f"{slot} has non-kcal keys — per-slot P/C/F/Fi is the bug #81 fixed"
            )
