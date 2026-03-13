"""Tests for nutrition_engine.daily_plan — Task 5."""
import pytest

from nutrition_engine.daily_plan import (
    classify_sleep_quality,
    adjust_deficit_for_sleep,
    generate_daily_plan,
)


class TestClassifySleepQuality:
    def test_normal_sleep_score(self):
        """7h sleep, 1h deep, Garmin score 80 → score ~65.8."""
        score = classify_sleep_quality(
            total_seconds=7 * 3600,
            deep_seconds=1 * 3600,
            garmin_score=80,
        )
        # duration: (7-5)/3*100=66.7, deep: (1-0.5)/1*100=50, garmin=80
        # composite: 0.5*66.7 + 0.25*50 + 0.25*80 = 65.8
        assert score >= 60

    def test_severe_sleep_deprivation(self):
        """<5h sleep → score < 30."""
        score = classify_sleep_quality(
            total_seconds=4 * 3600,
            deep_seconds=20 * 60,
            garmin_score=20,
        )
        assert score < 30

    def test_perfect_sleep(self):
        """8h+ sleep, 1.5h+ deep, Garmin 100 → score == 100."""
        score = classify_sleep_quality(
            total_seconds=9 * 3600,
            deep_seconds=2 * 3600,
            garmin_score=100,
        )
        assert score == 100

    def test_minimum_sleep(self):
        """<5h total, <0.5h deep, garmin 0 → score == 0."""
        score = classify_sleep_quality(
            total_seconds=4 * 3600,
            deep_seconds=10 * 60,
            garmin_score=0,
        )
        assert score == 0

    def test_duration_only_8h(self):
        """8h sleep, 0 deep, garmin 0 → score = 50 (duration contributes 0.5*100)."""
        score = classify_sleep_quality(
            total_seconds=8 * 3600,
            deep_seconds=0,
            garmin_score=0,
        )
        assert score == pytest.approx(50, abs=1)

    def test_score_bounded_0_100(self):
        """Score should always be in [0, 100]."""
        for total_h in [0, 3, 5, 7, 8, 10]:
            for deep_h in [0, 0.5, 1, 1.5, 2]:
                for gs in [0, 30, 60, 100]:
                    s = classify_sleep_quality(
                        total_seconds=total_h * 3600,
                        deep_seconds=deep_h * 3600,
                        garmin_score=gs,
                    )
                    assert 0 <= s <= 100, (
                        f"Score {s} out of bounds for total={total_h}h, deep={deep_h}h, garmin={gs}"
                    )

    def test_6h_sleep_mid_range(self):
        """6h sleep = linear between 5-8h → duration_score ~33."""
        score = classify_sleep_quality(
            total_seconds=6 * 3600,
            deep_seconds=1 * 3600,
            garmin_score=50,
        )
        # duration_score = (6-5)/(8-5)*100 = 33.3
        # deep_score = (1-0.5)/(1.5-0.5)*100 = 50
        # total = 0.5*33.3 + 0.25*50 + 0.25*50 = 16.7 + 12.5 + 12.5 = 41.7
        assert 35 <= score <= 50


class TestAdjustDeficitForSleep:
    def test_normal_sleep_unchanged(self):
        """Score >= 50 → deficit unchanged."""
        assert adjust_deficit_for_sleep(400, 80) == 400
        assert adjust_deficit_for_sleep(400, 50) == 400

    def test_moderate_sleep_halved(self):
        """Score 30-49 → deficit halved."""
        assert adjust_deficit_for_sleep(400, 40) == 200
        assert adjust_deficit_for_sleep(400, 30) == 200

    def test_severe_sleep_zero(self):
        """Score < 30 → deficit = 0."""
        assert adjust_deficit_for_sleep(400, 20) == 0
        assert adjust_deficit_for_sleep(400, 0) == 0

    def test_boundary_at_50(self):
        """Exactly 50 → unchanged."""
        assert adjust_deficit_for_sleep(400, 50) == 400

    def test_boundary_at_30(self):
        """Exactly 30 → halved (30 is in the 30-49 range)."""
        assert adjust_deficit_for_sleep(400, 30) == 200

    def test_boundary_at_29(self):
        """29 → zero."""
        assert adjust_deficit_for_sleep(400, 29) == 0


class TestGenerateDailyPlan:
    def test_basic_plan_has_all_fields(self):
        plan = generate_daily_plan(
            tdee=2300,
            deficit=400,
            weight_kg=80,
            training_day_type="rest",
            sleep_quality_score=80,
        )
        required_fields = [
            "target_calories", "target_protein", "target_carbs",
            "target_fat", "target_fiber", "tdee_used", "deficit_used",
            "adjustment_reason", "sleep_quality_score", "training_day_type",
            "is_refeed",
        ]
        for field in required_fields:
            assert field in plan, f"Missing field: {field}"

    def test_normal_sleep_adjustment_reason(self):
        plan = generate_daily_plan(
            tdee=2300,
            deficit=400,
            weight_kg=80,
            training_day_type="rest",
            sleep_quality_score=80,
        )
        assert plan["adjustment_reason"] == "normal"

    def test_poor_sleep_higher_calories(self):
        """Poor sleep plan should have more calories (less deficit) than normal."""
        normal = generate_daily_plan(
            tdee=2300, deficit=400, weight_kg=80,
            training_day_type="rest", sleep_quality_score=80,
        )
        poor = generate_daily_plan(
            tdee=2300, deficit=400, weight_kg=80,
            training_day_type="rest", sleep_quality_score=20,
        )
        assert poor["target_calories"] > normal["target_calories"]

    def test_moderate_sleep_halves_deficit(self):
        plan = generate_daily_plan(
            tdee=2300, deficit=400, weight_kg=80,
            training_day_type="rest", sleep_quality_score=40,
        )
        assert plan["deficit_used"] == 200
        assert plan["adjustment_reason"] == "sleep_moderate"

    def test_severe_sleep_zeros_deficit(self):
        plan = generate_daily_plan(
            tdee=2300, deficit=400, weight_kg=80,
            training_day_type="rest", sleep_quality_score=10,
        )
        assert plan["deficit_used"] == 0
        assert plan["adjustment_reason"] == "sleep_severe"

    def test_tdee_passed_through(self):
        plan = generate_daily_plan(
            tdee=2500, deficit=300, weight_kg=75,
            training_day_type="easy_run", sleep_quality_score=90,
        )
        assert plan["tdee_used"] == 2500

    def test_training_day_type_stored(self):
        plan = generate_daily_plan(
            tdee=2300, deficit=400, weight_kg=80,
            training_day_type="hard_run", sleep_quality_score=70,
        )
        assert plan["training_day_type"] == "hard_run"

    def test_sleep_quality_score_stored(self):
        plan = generate_daily_plan(
            tdee=2300, deficit=400, weight_kg=80,
            training_day_type="rest", sleep_quality_score=55,
        )
        assert plan["sleep_quality_score"] == 55

    def test_is_refeed_default_false(self):
        plan = generate_daily_plan(
            tdee=2300, deficit=400, weight_kg=80,
            training_day_type="rest", sleep_quality_score=80,
        )
        assert plan["is_refeed"] is False

    def test_is_refeed_true(self):
        plan = generate_daily_plan(
            tdee=2300, deficit=400, weight_kg=80,
            training_day_type="rest", sleep_quality_score=80,
            is_refeed=True,
        )
        assert plan["is_refeed"] is True

    def test_ffm_passed_through(self):
        """FFM should be passed to macro targets for RED-S floor."""
        plan = generate_daily_plan(
            tdee=2000, deficit=500, weight_kg=80,
            training_day_type="rest", sleep_quality_score=80,
            ffm_kg=65,
        )
        # RED-S floor: 25*65 = 1625; 2000-500 = 1500 < 1625
        assert plan["target_calories"] >= 1625
