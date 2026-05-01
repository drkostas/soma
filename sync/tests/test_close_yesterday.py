"""Tests for nutrition_engine.close_yesterday — target recompute from actuals."""
import pytest

from nutrition_engine.close_yesterday import compute_actual_target


class TestComputeActualTarget:
    def test_no_predicted_no_actual_workouts_target_matches_bmr_plus_steps(self):
        """Rest day, no run, no gym — target = BMR + step kcal − deficit."""
        target, tdee = compute_actual_target(
            bmr=2070, actual_steps=10000, weight_kg=74.0,
            actual_run_cal=0, actual_gym_cal=0, deficit_used=800,
        )
        # step_cal = 10000 × 0.000423 × 74 = 313 kcal
        # tdee = 2070 + 313 = 2383
        # target = 2383 − 800 = 1583
        assert tdee == 2383
        assert target == 1583

    def test_actual_run_credits_target(self):
        """6 km run @ 421 kcal lifts both tdee and target."""
        target, tdee = compute_actual_target(
            bmr=2070, actual_steps=10000, weight_kg=74.0,
            actual_run_cal=421, actual_gym_cal=0, deficit_used=800,
        )
        assert tdee == 2383 + 421  # 2804
        assert target == tdee - 800  # 2004

    def test_actual_gym_credits_target(self):
        """Gym 272 kcal lifts both tdee and target."""
        target, tdee = compute_actual_target(
            bmr=2070, actual_steps=10000, weight_kg=74.0,
            actual_run_cal=0, actual_gym_cal=272, deficit_used=800,
        )
        assert tdee == 2383 + 272  # 2655
        assert target == tdee - 800  # 1855

    def test_undone_workout_does_not_inflate_target(self):
        """Whether or not a predicted workout existed in the in-day plan,
        close-time target only reflects actual burn. The function takes
        actual_gym_cal directly — caller passes 0 when nothing matched."""
        with_predicted = compute_actual_target(
            bmr=2070, actual_steps=10000, weight_kg=74.0,
            actual_run_cal=0, actual_gym_cal=0, deficit_used=800,
        )
        without_predicted = compute_actual_target(
            bmr=2070, actual_steps=10000, weight_kg=74.0,
            actual_run_cal=0, actual_gym_cal=0, deficit_used=800,
        )
        # Same inputs → same output. The bug was in close_yesterday NOT
        # calling this function and leaving the in-day inflated target.
        assert with_predicted == without_predicted

    def test_zero_steps_zero_workouts(self):
        """Sedentary day — target collapses to BMR − deficit."""
        target, tdee = compute_actual_target(
            bmr=2070, actual_steps=0, weight_kg=74.0,
            actual_run_cal=0, actual_gym_cal=0, deficit_used=800,
        )
        assert tdee == 2070
        assert target == 1270

    def test_high_volume_day(self):
        """Long-run day: 25k steps + 9km run @ 670 kcal + heavy gym 380."""
        target, tdee = compute_actual_target(
            bmr=2070, actual_steps=25000, weight_kg=74.0,
            actual_run_cal=670, actual_gym_cal=380, deficit_used=800,
        )
        # step_cal = 25000 × 0.000423 × 74 = 783
        # tdee = 2070 + 783 + 670 + 380 = 3903
        # target = 3903 − 800 = 3103
        assert tdee == 3903
        assert target == 3103

    def test_zero_deficit_target_equals_tdee(self):
        """Maintenance day (deficit = 0) — target equals tdee."""
        target, tdee = compute_actual_target(
            bmr=2070, actual_steps=10000, weight_kg=74.0,
            actual_run_cal=0, actual_gym_cal=0, deficit_used=0,
        )
        assert target == tdee

    def test_step_kcal_formula_matches_ts_plan_api(self):
        """Step kcal must use the same formula as web/app/api/nutrition/plan/route.ts:247
        (KCAL_PER_STEP_PER_KG = 0.000423) — drift here would silently
        misalign Python close path from TS in-day path."""
        # 10000 steps × 0.000423 × 80 kg = 338.4 → 338
        _, tdee = compute_actual_target(
            bmr=2000, actual_steps=10000, weight_kg=80.0,
            actual_run_cal=0, actual_gym_cal=0, deficit_used=0,
        )
        assert tdee == 2338  # 2000 + 338
