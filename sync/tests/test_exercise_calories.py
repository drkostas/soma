"""Tests for HR-zone-based exercise calorie computation — Task 7."""
import pytest

from nutrition_engine.tdee import (
    _keytel_kcal_per_min,
    _estimate_step_duration_min,
    estimate_step_calories,
    compute_exercise_calories,
    HR_ZONE_MIDPOINTS,
    GYM_KCAL_PER_MIN,
    GYM_EPOC_FRACTION,
    EPOC_BY_ZONE,
)


# ---------------------------------------------------------------------------
# _keytel_kcal_per_min
# ---------------------------------------------------------------------------


class TestKeytelFormula:
    def test_male_positive(self):
        """Male at HR 150, 80kg, 30y should burn >0 kcal/min."""
        result = _keytel_kcal_per_min(150, 80, 30, "male")
        assert result > 0

    def test_female_positive(self):
        """Female at HR 150, 60kg, 30y should burn >0 kcal/min."""
        result = _keytel_kcal_per_min(150, 60, 30, "female")
        assert result > 0

    def test_higher_hr_more_calories(self):
        """Higher HR should yield more kcal/min."""
        low = _keytel_kcal_per_min(120, 80, 30, "male")
        high = _keytel_kcal_per_min(170, 80, 30, "male")
        assert high > low

    def test_heavier_person_more_calories(self):
        """Heavier person burns more at same HR (male formula)."""
        light = _keytel_kcal_per_min(150, 60, 30, "male")
        heavy = _keytel_kcal_per_min(150, 90, 30, "male")
        assert heavy > light

    def test_reasonable_range_male(self):
        """Male zone 3 effort should be roughly 10-20 kcal/min."""
        result = _keytel_kcal_per_min(158, 80, 30, "male")
        assert 5 < result < 25

    def test_defaults_to_male(self):
        """Unknown sex should use male formula."""
        male = _keytel_kcal_per_min(150, 80, 30, "male")
        unknown = _keytel_kcal_per_min(150, 80, 30, "other")
        assert male == unknown


# ---------------------------------------------------------------------------
# _estimate_step_duration_min
# ---------------------------------------------------------------------------


class TestEstimateStepDuration:
    def test_time_based(self):
        """Time-based step: 600 seconds = 10 minutes."""
        step = {"duration_type": "time", "duration_value": 600}
        assert _estimate_step_duration_min(step) == 10.0

    def test_distance_with_pace(self):
        """Distance step with pace targets: 1600m at ~269 sec/km => ~7.2 min."""
        step = {
            "duration_type": "distance",
            "duration_value": 1600,
            "target_pace_min": 262,
            "target_pace_max": 276,
            "hr_zone": 4,
        }
        duration = _estimate_step_duration_min(step)
        # 1.6km * avg(262,276) sec/km / 60 = 1.6 * 269 / 60 ≈ 7.17
        assert 6.5 < duration < 8.0

    def test_distance_no_pace_uses_zone(self):
        """Distance step without pace targets uses HR zone estimate."""
        step = {
            "duration_type": "distance",
            "duration_value": 1000,
            "hr_zone": 2,
        }
        duration = _estimate_step_duration_min(step)
        # Should estimate something reasonable for 1km at zone 2 pace
        assert duration > 0

    def test_lap_button_zero(self):
        """Lap-button step returns 0 duration."""
        step = {"duration_type": "lap_button", "duration_value": 0}
        assert _estimate_step_duration_min(step) == 0.0

    def test_zero_value_returns_zero(self):
        """Step with duration_value=0 returns 0."""
        step = {"duration_type": "distance", "duration_value": 0}
        assert _estimate_step_duration_min(step) == 0.0

    def test_missing_duration_type(self):
        """Step missing duration_type defaults to 0."""
        step = {"duration_value": 600}
        assert _estimate_step_duration_min(step) == 0.0


# ---------------------------------------------------------------------------
# estimate_step_calories
# ---------------------------------------------------------------------------


class TestEstimateStepCalories:
    def test_warmup_zone2(self):
        """Warmup in zone 2 for 10 min should yield reasonable calories."""
        step = {
            "step_type": "warmup",
            "hr_zone": 2,
            "duration_type": "time",
            "duration_value": 600,  # 10 min
        }
        cals = estimate_step_calories(step, weight_kg=80, age=30, sex="male")
        # ~10 min at zone 2 HR (~140 bpm) should be roughly 80-180 kcal
        assert 40 < cals < 250

    def test_interval_zone4(self):
        """Interval in zone 4 for 4 min should yield substantial calories."""
        step = {
            "step_type": "interval",
            "hr_zone": 4,
            "duration_type": "time",
            "duration_value": 240,  # 4 min
        }
        cals = estimate_step_calories(step, weight_kg=80, age=30, sex="male")
        assert cals > 0

    def test_recovery_time_based(self):
        """Recovery jog (zone 1) for 2 min."""
        step = {
            "step_type": "recovery",
            "hr_zone": 1,
            "duration_type": "time",
            "duration_value": 120,  # 2 min
        }
        cals = estimate_step_calories(step, weight_kg=80, age=30, sex="male")
        assert cals > 0

    def test_lap_button_returns_zero(self):
        """Lap-button step => 0 calories."""
        step = {
            "step_type": "interval",
            "hr_zone": 4,
            "duration_type": "lap_button",
            "duration_value": 0,
        }
        cals = estimate_step_calories(step, weight_kg=80, age=30, sex="male")
        assert cals == 0.0

    def test_zone4_more_than_zone2_same_duration(self):
        """Zone 4 should burn more per minute than zone 2."""
        base = {"duration_type": "time", "duration_value": 600}
        z2 = estimate_step_calories(
            {**base, "hr_zone": 2, "step_type": "active"}, 80, 30, "male"
        )
        z4 = estimate_step_calories(
            {**base, "hr_zone": 4, "step_type": "interval"}, 80, 30, "male"
        )
        assert z4 > z2

    def test_includes_epoc(self):
        """Calories should be higher than raw Keytel (because EPOC is added)."""
        step = {
            "step_type": "interval",
            "hr_zone": 4,
            "duration_type": "time",
            "duration_value": 600,
        }
        total = estimate_step_calories(step, 80, 30, "male")
        # EPOC for zone 4 is 12%, so total should be > base * 1.0
        hr = HR_ZONE_MIDPOINTS[4]
        base = _keytel_kcal_per_min(hr, 80, 30, "male") * 10  # 10 min
        assert total > base


# ---------------------------------------------------------------------------
# compute_exercise_calories
# ---------------------------------------------------------------------------


class TestComputeExerciseCalories:
    def test_rest_day_empty_steps(self):
        """Rest day with no workout steps => 0 calories."""
        assert compute_exercise_calories([], 80, 30, "male") == 0.0

    def test_rest_day_none_steps(self):
        """None steps => 0 calories."""
        assert compute_exercise_calories(None, 80, 30, "male") == 0.0

    def test_easy_run_reasonable_range(self):
        """Easy run total should be in a reasonable range."""
        steps = [
            {"step_type": "warmup", "hr_zone": 2, "duration_type": "time",
             "duration_value": 600},
            {"step_type": "active", "hr_zone": 2, "duration_type": "distance",
             "duration_value": 5000, "target_pace_min": 340, "target_pace_max": 360},
            {"step_type": "cooldown", "hr_zone": 1, "duration_type": "time",
             "duration_value": 300},
        ]
        cals = compute_exercise_calories(steps, 80, 30, "male")
        # Easy 5K + warmup/cooldown: roughly 200-600 kcal
        assert 100 < cals < 800

    def test_intervals_more_than_easy_same_distance(self):
        """Interval session should burn more than easy run for similar distance."""
        easy_steps = [
            {"step_type": "active", "hr_zone": 2, "duration_type": "distance",
             "duration_value": 5000, "target_pace_min": 340, "target_pace_max": 360},
        ]
        interval_steps = [
            {"step_type": "interval", "hr_zone": 4, "duration_type": "distance",
             "duration_value": 5000, "target_pace_min": 250, "target_pace_max": 270},
        ]
        easy_cals = compute_exercise_calories(easy_steps, 80, 30, "male")
        interval_cals = compute_exercise_calories(interval_steps, 80, 30, "male")
        assert interval_cals > easy_cals

    def test_scales_with_weight(self):
        """Heavier person burns more calories for same workout."""
        steps = [
            {"step_type": "active", "hr_zone": 3, "duration_type": "time",
             "duration_value": 1800},
        ]
        light = compute_exercise_calories(steps, 60, 30, "male")
        heavy = compute_exercise_calories(steps, 90, 30, "male")
        assert heavy > light

    def test_gym_only(self):
        """Gym-only session (no run steps)."""
        cals = compute_exercise_calories(
            [], 80, 30, "male", has_gym=True, gym_duration_min=60
        )
        # 60 min * 6 kcal/min * 1.10 (EPOC) = 396
        expected = 60 * GYM_KCAL_PER_MIN * (1 + GYM_EPOC_FRACTION)
        assert cals == pytest.approx(expected, rel=0.01)

    def test_run_plus_gym(self):
        """Run + gym session sums both contributions."""
        run_steps = [
            {"step_type": "active", "hr_zone": 2, "duration_type": "time",
             "duration_value": 1200},
        ]
        run_only = compute_exercise_calories(run_steps, 80, 30, "male")
        gym_only = compute_exercise_calories(
            [], 80, 30, "male", has_gym=True, gym_duration_min=60
        )
        both = compute_exercise_calories(
            run_steps, 80, 30, "male", has_gym=True, gym_duration_min=60
        )
        assert both == pytest.approx(run_only + gym_only, rel=0.01)
