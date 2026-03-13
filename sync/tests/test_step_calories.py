"""Tests for step calorie computation (NEAT) — Task 8."""
import pytest

from nutrition_engine.tdee import compute_step_calories, bootstrap_tdee_base


class TestComputeStepCalories:
    def test_zero_steps(self):
        assert compute_step_calories(0, weight_kg=80) == 0

    def test_10k_steps(self):
        result = compute_step_calories(10000, weight_kg=80)
        assert 300 < result < 500  # ~0.0005 * 10000 * 80 = 400

    def test_exact_10k_80kg(self):
        """10000 * 0.0005 * 80 = 400.0"""
        assert compute_step_calories(10000, weight_kg=80) == 400.0

    def test_scales_with_steps(self):
        low = compute_step_calories(5000, weight_kg=80)
        high = compute_step_calories(13000, weight_kg=80)
        assert high > low

    def test_scales_with_weight(self):
        light = compute_step_calories(10000, weight_kg=60)
        heavy = compute_step_calories(10000, weight_kg=80)
        assert heavy > light

    def test_negative_steps_zero(self):
        assert compute_step_calories(-100, weight_kg=80) == 0

    def test_returns_float(self):
        result = compute_step_calories(7500, weight_kg=75)
        assert isinstance(result, float)

    def test_rounded_to_one_decimal(self):
        result = compute_step_calories(7777, weight_kg=73)
        # 7777 * 0.0005 * 73 = 283.8605 → 283.9
        assert result == round(7777 * 0.0005 * 73, 1)


class TestBootstrapTdeeBase:
    def test_returns_bmr(self):
        """bootstrap_tdee_base just returns BMR unchanged."""
        assert bootstrap_tdee_base(1700) == 1700

    def test_float_precision(self):
        assert bootstrap_tdee_base(1823.5) == 1823.5
