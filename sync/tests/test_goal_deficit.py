"""Tests for compute_deficit_from_goal — Task 9."""
import pytest
from datetime import date

from nutrition_engine.tdee import compute_deficit_from_goal


class TestComputeDeficitFromGoal:
    def test_basic_deficit(self):
        result = compute_deficit_from_goal(
            weight_kg=80, current_bf_pct=17, target_bf_pct=12,
            target_date=date(2026, 9, 13), today=date(2026, 3, 13),
        )
        assert 0 < result["daily_deficit"] <= 500
        assert result["fat_to_lose_kg"] > 0
        assert result["timeline_weeks"] > 0

    def test_caps_at_500(self):
        result = compute_deficit_from_goal(80, 25, 10, date(2026, 4, 1), date(2026, 3, 13))
        assert result["daily_deficit"] == 500
        assert result["safety"] == "red"

    def test_at_goal_zero_deficit(self):
        result = compute_deficit_from_goal(80, 12, 12, date(2026, 9, 13), date(2026, 3, 13))
        assert result["daily_deficit"] == 0

    def test_safety_traffic_light(self):
        safe = compute_deficit_from_goal(80, 17, 14, date(2026, 9, 13), date(2026, 3, 13))
        assert safe["safety"] in ("green", "yellow")
        aggressive = compute_deficit_from_goal(80, 25, 10, date(2026, 4, 1), date(2026, 3, 13))
        assert aggressive["safety"] == "red"

    def test_recompute_after_weight_drop(self):
        before = compute_deficit_from_goal(80, 17, 12, date(2026, 9, 13), date(2026, 3, 13))
        after = compute_deficit_from_goal(78, 15.5, 12, date(2026, 9, 13), date(2026, 4, 13))
        assert 0 < after["daily_deficit"] <= 500

    def test_result_has_all_fields(self):
        result = compute_deficit_from_goal(80, 17, 12, date(2026, 9, 13), date(2026, 3, 13))
        for field in ["daily_deficit", "fat_to_lose_kg", "timeline_weeks",
                       "weekly_rate_pct", "safety"]:
            assert field in result, f"Missing field: {field}"

    def test_target_below_current_bf(self):
        """Target BF% higher than current → no deficit needed."""
        result = compute_deficit_from_goal(80, 12, 17, date(2026, 9, 13), date(2026, 3, 13))
        assert result["daily_deficit"] == 0
        assert result["fat_to_lose_kg"] == 0
        assert result["safety"] == "green"

    def test_single_day_timeline(self):
        """Edge case: target date is tomorrow."""
        result = compute_deficit_from_goal(80, 17, 12, date(2026, 3, 14), date(2026, 3, 13))
        assert result["daily_deficit"] == 500  # capped
        assert result["safety"] == "red"

    def test_default_today(self):
        """When today is not provided, uses date.today()."""
        result = compute_deficit_from_goal(
            weight_kg=80, current_bf_pct=17, target_bf_pct=12,
            target_date=date(2030, 1, 1),
        )
        assert result["daily_deficit"] >= 0
