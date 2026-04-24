"""M10 Phase A — Weekly wrap-up tests."""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from nutrition_engine.weekly_wrapup import (
    DayRecord,
    adherence_grade,
    compute_weekly_wrapup,
    wrapup_takeaway,
)


def _day(
    offset: int,
    *,
    target_kcal: int = 2000,
    actual_kcal: int = 1950,
    protein_g: float = 140,
    weight_kg: float | None = 75.0,
    had_training: bool = False,
    was_closed: bool = True,
) -> DayRecord:
    return DayRecord(
        day=date(2026, 4, 1) + timedelta(days=offset),
        target_kcal=target_kcal,
        actual_kcal=actual_kcal,
        protein_g=protein_g,
        weight_kg=weight_kg,
        had_training=had_training,
        was_closed=was_closed,
    )


# ---------------------------------------------------------------------------
# M10A.1 aggregator
# ---------------------------------------------------------------------------


class TestComputeWeeklyWrapup:
    def test_empty_list_returns_zeros(self):
        w = compute_weekly_wrapup([], weight_kg=75)
        assert w.adherence_pct == 0
        assert w.avg_kcal == 0
        assert w.avg_protein_g == 0
        assert w.training_days == 0
        assert w.days_closed == 0
        assert w.days_total == 0
        assert w.weight_delta_kg is None

    def test_all_days_in_range_hits_adherence(self):
        # 7 days, all within ±10% of target → 100% adherence
        days = [_day(i, actual_kcal=2050) for i in range(7)]
        w = compute_weekly_wrapup(days, weight_kg=75)
        assert w.adherence_pct == 100

    def test_partial_adherence(self):
        # 7 closed days, 5 in range + 2 way over → 5/7 ~71%
        days = [_day(i, actual_kcal=2050) for i in range(5)] + \
               [_day(i + 5, actual_kcal=3000) for i in range(2)]
        w = compute_weekly_wrapup(days, weight_kg=75)
        assert 70 <= w.adherence_pct <= 72

    def test_open_days_skipped_from_adherence_math(self):
        # 3 open + 4 closed (all on-target) → 4/4 = 100%
        days = [_day(i, was_closed=False) for i in range(3)] + \
               [_day(i + 3) for i in range(4)]
        w = compute_weekly_wrapup(days, weight_kg=75)
        assert w.adherence_pct == 100
        assert w.days_closed == 4
        assert w.days_total == 7

    def test_avg_kcal_across_closed_days(self):
        days = [
            _day(0, actual_kcal=2000),
            _day(1, actual_kcal=2100),
            _day(2, actual_kcal=1900),
        ]
        w = compute_weekly_wrapup(days, weight_kg=75)
        assert w.avg_kcal == 2000

    def test_avg_protein_per_kg(self):
        days = [_day(i, protein_g=150) for i in range(4)]
        w = compute_weekly_wrapup(days, weight_kg=75)
        assert w.avg_protein_g == 150
        assert w.avg_protein_g_per_kg == 2.0

    def test_training_days_counts_flagged_days(self):
        days = [
            _day(0, had_training=True),
            _day(1, had_training=False),
            _day(2, had_training=True),
            _day(3, had_training=True),
        ]
        w = compute_weekly_wrapup(days, weight_kg=75)
        assert w.training_days == 3

    def test_weight_delta_last_minus_first(self):
        days = [
            _day(0, weight_kg=75.0),
            _day(1, weight_kg=74.8),
            _day(2, weight_kg=74.5),
        ]
        w = compute_weekly_wrapup(days, weight_kg=75)
        assert w.weight_delta_kg == pytest.approx(-0.5, abs=0.01)

    def test_weight_delta_ignores_missing_weights(self):
        days = [
            _day(0, weight_kg=75.0),
            _day(1, weight_kg=None),
            _day(2, weight_kg=74.0),
        ]
        w = compute_weekly_wrapup(days, weight_kg=75)
        assert w.weight_delta_kg == pytest.approx(-1.0, abs=0.01)

    def test_week_start_and_end(self):
        days = [_day(i) for i in range(7)]
        w = compute_weekly_wrapup(days, weight_kg=75)
        assert w.week_start == date(2026, 4, 1)
        assert w.week_end == date(2026, 4, 7)


# ---------------------------------------------------------------------------
# M10A.2 grade + takeaway
# ---------------------------------------------------------------------------


class TestAdherenceGrade:
    def test_90_is_a(self):
        assert adherence_grade(90) == "A"
        assert adherence_grade(100) == "A"

    def test_80_89_is_b(self):
        assert adherence_grade(80) == "B"
        assert adherence_grade(89) == "B"

    def test_70_79_is_c(self):
        assert adherence_grade(70) == "C"

    def test_60_69_is_d(self):
        assert adherence_grade(65) == "D"

    def test_below_60_is_f(self):
        assert adherence_grade(59) == "F"
        assert adherence_grade(0) == "F"


class TestWrapupTakeaway:
    def test_strong_week_praises(self):
        days = [_day(i, actual_kcal=2000, protein_g=165, weight_kg=75 - i * 0.08,
                     had_training=(i % 2 == 0)) for i in range(7)]
        w = compute_weekly_wrapup(days, weight_kg=75)
        txt = wrapup_takeaway(w)
        assert len(txt) > 0
        assert any(word in txt.lower() for word in ["strong", "solid", "on track"])

    def test_off_track_flags(self):
        days = [_day(i, actual_kcal=3000, protein_g=100) for i in range(7)]
        w = compute_weekly_wrapup(days, weight_kg=75)
        txt = wrapup_takeaway(w)
        assert len(txt) > 0
        # Should mention adherence being off
        assert any(word in txt.lower() for word in ["over", "off", "below"])

    def test_no_data_returns_safe_string(self):
        w = compute_weekly_wrapup([], weight_kg=75)
        txt = wrapup_takeaway(w)
        assert len(txt) > 0
        assert "no data" in txt.lower() or "not enough" in txt.lower()
