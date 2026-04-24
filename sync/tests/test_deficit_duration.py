"""Tests for deficit duration counter (M1.7).

Research: Byrne 2018 MATADOR, Peos 2021 ICECAP, Trexler 2014.

Counter tracks consecutive days of intake < 95% TDEE. Reset rules:
- 7+ consecutive maintenance days: full reset
- 3-6 maintenance days: half reset
- <3 maintenance days: no reset
Severity scaling:
- Deficit > 25% TDEE: shortens thresholds by 4 weeks
- Deficit < 15% TDEE: extends by 4 weeks
Default thresholds: 56 (soft warn) / 84 (strong) / 112 (hard stop).
"""

import pytest

from nutrition_engine.deficit_duration import (
    compute_counter,
    get_thresholds,
    classify_counter,
    CounterStatus,
    DurationThresholds,
    DEFICIT_RATIO_THRESHOLD,
)


class TestDeficitRatioThreshold:
    def test_constant(self):
        # Intake ≥ 95% TDEE = maintenance (refeed threshold from V14)
        assert DEFICIT_RATIO_THRESHOLD == 0.95


class TestComputeCounter:
    def _days(self, intakes_vs_tdee: list[tuple[float, float]]) -> list[dict]:
        """Helper: build a list of day dicts from (intake, tdee) tuples."""
        return [{"intake_kcal": i, "tdee_kcal": t} for i, t in intakes_vs_tdee]

    def test_seven_deficit_days(self):
        # 7 consecutive deficit days
        days = self._days([(1700, 2500)] * 7)
        assert compute_counter(days) == 7

    def test_maintenance_break_resets_fully(self):
        # 10 deficit days, 7 maintenance, 3 more deficit → counter = 3
        days = self._days(
            [(1700, 2500)] * 10
            + [(2500, 2500)] * 7
            + [(1700, 2500)] * 3
        )
        assert compute_counter(days) == 3

    def test_short_maintenance_half_resets(self):
        # 10 deficit, 5 maintenance (half-reset), 3 deficit
        # After 10 deficit + 5 maintenance (half reset): counter = 10/2 = 5
        # After 3 more deficit: 5 + 3 = 8
        days = self._days(
            [(1700, 2500)] * 10
            + [(2500, 2500)] * 5
            + [(1700, 2500)] * 3
        )
        assert compute_counter(days) == 8

    def test_one_day_maintenance_no_reset(self):
        # 10 deficit + 1 maintenance + 3 deficit
        # <3 maintenance days = no reset → counter = 10 + 3 = 13
        days = self._days(
            [(1700, 2500)] * 10
            + [(2500, 2500)] * 1
            + [(1700, 2500)] * 3
        )
        assert compute_counter(days) == 13

    def test_empty_days(self):
        assert compute_counter([]) == 0

    def test_all_maintenance(self):
        days = self._days([(2500, 2500)] * 14)
        assert compute_counter(days) == 0

    def test_intake_exactly_95pct_is_maintenance(self):
        # 2500 × 0.95 = 2375; intake = 2375 is maintenance (not deficit)
        days = self._days([(2375, 2500)] * 10)
        assert compute_counter(days) == 0

    def test_intake_just_below_95pct_is_deficit(self):
        # 2370 < 2375 = deficit
        days = self._days([(2370, 2500)] * 10)
        assert compute_counter(days) == 10


class TestGetThresholds:
    def test_default_thresholds(self):
        # Moderate deficit (15-25% of TDEE) → default 56/84/112
        t = get_thresholds(avg_deficit_pct=20.0)
        assert t.soft_warn_days == 56
        assert t.strong_recommend_days == 84
        assert t.hard_stop_days == 112

    def test_aggressive_deficit_tightens(self):
        # > 25% deficit: shortens by 4 weeks (28 days)
        t = get_thresholds(avg_deficit_pct=30.0)
        assert t.soft_warn_days == 28
        assert t.strong_recommend_days == 56
        assert t.hard_stop_days == 84

    def test_mild_deficit_extends(self):
        # < 15% deficit: extends by 4 weeks
        t = get_thresholds(avg_deficit_pct=10.0)
        assert t.soft_warn_days == 84
        assert t.strong_recommend_days == 112
        assert t.hard_stop_days == 140

    def test_boundary_at_25(self):
        # Exactly 25% = moderate
        t = get_thresholds(avg_deficit_pct=25.0)
        assert t.soft_warn_days == 56

    def test_boundary_at_15(self):
        t = get_thresholds(avg_deficit_pct=15.0)
        assert t.soft_warn_days == 56


class TestClassifyCounter:
    def test_under_soft_green(self):
        thresholds = DurationThresholds(56, 84, 112)
        assert classify_counter(20, thresholds) is CounterStatus.GREEN
        assert classify_counter(55, thresholds) is CounterStatus.GREEN

    def test_soft_warn(self):
        thresholds = DurationThresholds(56, 84, 112)
        assert classify_counter(56, thresholds) is CounterStatus.WARN
        assert classify_counter(83, thresholds) is CounterStatus.WARN

    def test_strong_recommend(self):
        thresholds = DurationThresholds(56, 84, 112)
        assert classify_counter(84, thresholds) is CounterStatus.STRONG
        assert classify_counter(111, thresholds) is CounterStatus.STRONG

    def test_hard_stop(self):
        thresholds = DurationThresholds(56, 84, 112)
        assert classify_counter(112, thresholds) is CounterStatus.HARD_STOP
        assert classify_counter(200, thresholds) is CounterStatus.HARD_STOP


class TestCurrentUserScenarios:
    def _days(self, intakes_vs_tdee: list[tuple[float, float]]) -> list[dict]:
        return [{"intake_kcal": i, "tdee_kcal": t} for i, t in intakes_vs_tdee]

    def test_full_cut_without_break_triggers_warn(self):
        # 60 consecutive days at ~700 kcal deficit (~28% of 2500 TDEE)
        # Deficit pct = 28% → aggressive → soft at 28 days
        days = self._days([(1800, 2500)] * 60)
        counter = compute_counter(days)
        # avg deficit pct
        avg_deficit_pct = 28.0  # (2500-1800)/2500
        thresholds = get_thresholds(avg_deficit_pct=avg_deficit_pct)
        status = classify_counter(counter, thresholds)
        # 60 days > strong recommend 56 → STRONG
        assert status is CounterStatus.STRONG

    def test_moderate_cut_8_weeks_just_warns(self):
        # 56 days at ~20% deficit (default thresholds)
        days = self._days([(2000, 2500)] * 56)  # 20% deficit
        counter = compute_counter(days)
        thresholds = get_thresholds(avg_deficit_pct=20.0)
        status = classify_counter(counter, thresholds)
        assert status is CounterStatus.WARN
