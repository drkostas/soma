"""Tests for M5 Phase A — Adaptive Systems core (V2 §4).

M5.1 Adaptive TDEE
M5.2 Refeed Pressure Score
M5.3 Diet Break level
M5.4 Plateau detection + type classifier
"""

import pytest

from nutrition_engine.adaptive import (
    AdaptiveTdeeResult,
    DietBreakLevel,
    PlateauResult,
    PlateauType,
    compute_adaptive_tdee,
    compute_refeed_pressure_score,
    detect_plateau,
    recommend_diet_break,
)
from nutrition_engine.tier import Tier
from nutrition_engine.weight_prediction import DayPoint


# ---------------------------------------------------------------------------
# M5.1 Adaptive TDEE
# ---------------------------------------------------------------------------


def _flat_history(days: int, intake: float, weight: float, tdee: float) -> list[DayPoint]:
    return [
        DayPoint(day=i, intake_kcal=intake, tdee_kcal=tdee, weight_kg=weight)
        for i in range(days)
    ]


def _losing_history(days: int, intake: float, start_weight: float, daily_loss_kg: float, tdee: float) -> list[DayPoint]:
    return [
        DayPoint(
            day=i, intake_kcal=intake, tdee_kcal=tdee,
            weight_kg=start_weight - daily_loss_kg * i,
        )
        for i in range(days)
    ]


class TestAdaptiveTdee:
    def test_short_history_returns_none(self):
        assert compute_adaptive_tdee(_flat_history(5, 2500, 74, 2500)) is None

    def test_steady_state_returns_intake(self):
        hist = _flat_history(14, 2500, 74, 2500)
        r = compute_adaptive_tdee(hist)
        assert r is not None
        # No weight change → effective_tdee ≈ avg_intake
        assert r.effective_tdee == pytest.approx(2500.0, abs=10)
        assert r.discrepancy_pct < 2.0
        assert r.drift_flag is False

    def test_losing_weight_implies_higher_tdee(self):
        # 14 days, 2000 intake, losing 1 kg → effective ≈ 2000 + 7700/14 ≈ 2550
        hist = _losing_history(14, intake=2000, start_weight=74, daily_loss_kg=1.0/14, tdee=2500)
        r = compute_adaptive_tdee(hist)
        assert r is not None
        assert 2500 <= r.effective_tdee <= 2600

    def test_drift_flag_fires_on_sustained_discrepancy(self):
        # Reported TDEE 2500, effective ~2550 → >10% discrepancy? No, 2%
        # Make it dramatic: reported 2000 vs effective 2550 = 27.5% discrepancy
        hist = [
            DayPoint(day=i, intake_kcal=2000, tdee_kcal=2000, weight_kg=74 - 1.0/14 * i)
            for i in range(14)
        ]
        r = compute_adaptive_tdee(hist)
        assert r is not None
        assert r.discrepancy_pct > 10
        assert r.drift_flag is True

    def test_returns_dataclass(self):
        hist = _flat_history(14, 2500, 74, 2500)
        r = compute_adaptive_tdee(hist)
        assert isinstance(r, AdaptiveTdeeResult)


# ---------------------------------------------------------------------------
# M5.2 Refeed Pressure Score
# ---------------------------------------------------------------------------


class TestRefeedPressureScore:
    def test_zero_signals_is_zero(self):
        rps = compute_refeed_pressure_score(
            deficit_days=0, weight_stall_days=0,
            hrv_7d_trend_pct=0, readiness_avg=80,
            bf_tier=Tier.T2, weight_loss_velocity_pct_per_wk=0.5,
        )
        assert rps == 0

    def test_all_maxed_clamps_to_100(self):
        rps = compute_refeed_pressure_score(
            deficit_days=100, weight_stall_days=30,
            hrv_7d_trend_pct=-15, readiness_avg=30,
            bf_tier=Tier.T4, weight_loss_velocity_pct_per_wk=2.0,
        )
        assert rps == 100

    def test_monotone_in_deficit_days(self):
        base = dict(
            weight_stall_days=0, hrv_7d_trend_pct=0,
            readiness_avg=80, bf_tier=Tier.T2,
            weight_loss_velocity_pct_per_wk=0.5,
        )
        a = compute_refeed_pressure_score(deficit_days=10, **base)
        b = compute_refeed_pressure_score(deficit_days=30, **base)
        c = compute_refeed_pressure_score(deficit_days=56, **base)
        assert a <= b <= c

    def test_hrv_downtrend_adds_pressure(self):
        base = dict(
            deficit_days=30, weight_stall_days=0,
            readiness_avg=80, bf_tier=Tier.T2,
            weight_loss_velocity_pct_per_wk=0.5,
        )
        calm = compute_refeed_pressure_score(hrv_7d_trend_pct=0, **base)
        down = compute_refeed_pressure_score(hrv_7d_trend_pct=-10, **base)
        assert down > calm

    def test_threshold_trigger_at_60(self):
        # Synthetic high-pressure case: late in a cut with stalled weight,
        # HRV trending down, low readiness, leaner tier, above rate cap.
        rps = compute_refeed_pressure_score(
            deficit_days=56, weight_stall_days=12,
            hrv_7d_trend_pct=-10, readiness_avg=50,
            bf_tier=Tier.T3, weight_loss_velocity_pct_per_wk=1.3,
        )
        assert rps >= 60


# ---------------------------------------------------------------------------
# M5.3 Diet Break level
# ---------------------------------------------------------------------------


class TestDietBreak:
    def test_none_below_56(self):
        for d in [0, 1, 30, 55]:
            assert recommend_diet_break(d) == DietBreakLevel.NONE

    def test_suggested_at_56(self):
        assert recommend_diet_break(56) == DietBreakLevel.SUGGESTED

    def test_suggested_range(self):
        assert recommend_diet_break(70) == DietBreakLevel.SUGGESTED

    def test_strong_at_84(self):
        assert recommend_diet_break(84) == DietBreakLevel.STRONG

    def test_mandatory_at_112(self):
        assert recommend_diet_break(112) == DietBreakLevel.MANDATORY
        assert recommend_diet_break(200) == DietBreakLevel.MANDATORY

    def test_monotonic_never_decreases(self):
        prev_ord = -1
        order = {
            DietBreakLevel.NONE: 0,
            DietBreakLevel.SUGGESTED: 1,
            DietBreakLevel.STRONG: 2,
            DietBreakLevel.MANDATORY: 3,
        }
        for d in range(0, 200, 5):
            o = order[recommend_diet_break(d)]
            assert o >= prev_ord
            prev_ord = o


# ---------------------------------------------------------------------------
# M5.4 Plateau detection
# ---------------------------------------------------------------------------


class TestPlateau:
    def test_too_short_history_not_plateau(self):
        hist = _flat_history(10, 2000, 74, 2500)
        r = detect_plateau(hist, tdee_stable=True)
        assert r.is_plateau is False

    def test_losing_weight_not_plateau(self):
        hist = _losing_history(30, intake=2000, start_weight=74, daily_loss_kg=0.1, tdee=2500)
        r = detect_plateau(hist, tdee_stable=True)
        assert r.is_plateau is False

    def test_flat_weight_is_plateau(self):
        hist = _flat_history(25, 2000, 74, 2500)
        r = detect_plateau(hist, tdee_stable=True)
        assert r.is_plateau is True
        # Default to INTAKE_CREEP when no subjective signals
        assert r.type == PlateauType.INTAKE_CREEP

    def test_flat_with_hunger_is_adaptation(self):
        hist = _flat_history(25, 2000, 74, 2500)
        r = detect_plateau(hist, tdee_stable=True, hunger_elevated=True)
        assert r.type == PlateauType.ADAPTATION

    def test_strength_improving_is_recomp_not_plateau(self):
        hist = _flat_history(25, 2000, 74, 2500)
        r = detect_plateau(hist, tdee_stable=True, strength_improving=True)
        assert r.type == PlateauType.RECOMP
        assert r.is_plateau is False

    def test_tdee_unstable_gates_plateau(self):
        hist = _flat_history(25, 2000, 74, 2500)
        r = detect_plateau(hist, tdee_stable=False)
        assert r.is_plateau is False

    def test_returns_dataclass(self):
        hist = _flat_history(25, 2000, 74, 2500)
        r = detect_plateau(hist, tdee_stable=True)
        assert isinstance(r, PlateauResult)
        assert hasattr(r, "ema_slope_kg_per_wk")
        assert hasattr(r, "days_stalled")
