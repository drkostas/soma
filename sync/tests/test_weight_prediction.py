"""Tests for 3-layer weight prediction (M3 Phase D).

Research basis: V2 §8.3.

Layer A: personal kcal-per-kg EWMA (weeks 4+, clamp [5500, 9500])
Layer B: Forbes-composition density rho = p*1816 + (1-p)*9441 where p = 10.4/(10.4+FM)
Layer C: glycogen/water (1.2kg, τ=4d) + refeed sawtooth (0.8kg, τ=2d)
"""

from dataclasses import dataclass

import pytest

from nutrition_engine.weight_prediction import (
    DayPoint,
    OverlayResult,
    forbes_energy_density_kcal_per_kg,
    glycogen_water_overlay,
    personal_kcal_per_kg,
)


# ---------------------------------------------------------------------------
# Layer B — Forbes-composition density
# ---------------------------------------------------------------------------


class TestForbesDensity:
    def test_fm_20kg(self):
        # p = 10.4/30.4 ≈ 0.342 → rho = 0.342*1816 + 0.658*9441 ≈ 6834
        rho = forbes_energy_density_kcal_per_kg(fm_kg=20.0)
        assert 6700 <= rho <= 7000

    def test_fm_5kg_lean(self):
        # p ≈ 0.676 → density biased toward lean (lower)
        lean = forbes_energy_density_kcal_per_kg(fm_kg=5.0)
        assert 4000 <= lean <= 5000

    def test_fm_80kg_heavy(self):
        # p ≈ 0.115 → density biased toward fat (higher)
        heavy = forbes_energy_density_kcal_per_kg(fm_kg=80.0)
        assert 8500 <= heavy <= 9500

    def test_monotone_in_fm(self):
        # Higher FM → denser (more fat share)
        d10 = forbes_energy_density_kcal_per_kg(fm_kg=10.0)
        d20 = forbes_energy_density_kcal_per_kg(fm_kg=20.0)
        d40 = forbes_energy_density_kcal_per_kg(fm_kg=40.0)
        assert d10 < d20 < d40

    def test_fm_zero_is_pure_lean(self):
        rho = forbes_energy_density_kcal_per_kg(fm_kg=0.0)
        assert rho == pytest.approx(1816.0)

    def test_negative_fm_raises(self):
        with pytest.raises(ValueError):
            forbes_energy_density_kcal_per_kg(fm_kg=-1.0)


# ---------------------------------------------------------------------------
# Layer A — personal kcal-per-kg EWMA
# ---------------------------------------------------------------------------


def _make_history(days: int, intake: float, tdee: float, start_weight_kg: float, true_rho: float) -> list[DayPoint]:
    """Build a synthetic history at a fixed per-kg energy density.

    If intake < tdee by `deficit` each day, the user loses `deficit / true_rho`
    kg/day. Used to verify Layer A recovers true_rho from history.
    """
    daily_deficit = tdee - intake  # positive
    daily_loss = daily_deficit / true_rho
    out: list[DayPoint] = []
    for i in range(days):
        w = start_weight_kg - daily_loss * i
        out.append(DayPoint(day=i, intake_kcal=intake, tdee_kcal=tdee, weight_kg=w))
    return out


class TestLayerA:
    def test_too_short_history_returns_none(self):
        hist = _make_history(days=20, intake=2000, tdee=2800, start_weight_kg=74.0, true_rho=7000)
        assert personal_kcal_per_kg(hist, min_days=28) is None

    def test_recovers_rho_on_steady_state(self):
        hist = _make_history(days=60, intake=2000, tdee=2800, start_weight_kg=74.0, true_rho=7000)
        result = personal_kcal_per_kg(hist)
        assert result is not None
        assert 6800 <= result <= 7200

    def test_clamps_above_9500(self):
        # Extreme: tiny weight loss despite big deficit → rho huge, clamp to 9500
        hist = _make_history(days=60, intake=2000, tdee=2800, start_weight_kg=74.0, true_rho=15000)
        result = personal_kcal_per_kg(hist)
        assert result is not None
        assert result <= 9500

    def test_clamps_below_5500(self):
        hist = _make_history(days=60, intake=2000, tdee=2800, start_weight_kg=74.0, true_rho=3500)
        result = personal_kcal_per_kg(hist)
        assert result is not None
        assert result >= 5500

    def test_empty_history_returns_none(self):
        assert personal_kcal_per_kg([]) is None

    def test_zero_weight_delta_skipped(self):
        # Days with identical weights don't crash — they're skipped (can't divide by 0).
        hist = [
            DayPoint(day=i, intake_kcal=2500, tdee_kcal=2500, weight_kg=74.0)
            for i in range(40)
        ]
        # No deficit, no delta → no signal → fall back to None
        result = personal_kcal_per_kg(hist)
        assert result is None


# ---------------------------------------------------------------------------
# Layer C — glycogen/water overlay
# ---------------------------------------------------------------------------


class TestLayerC:
    def test_no_events_tight_ci(self):
        r = glycogen_water_overlay(
            central_kg=74.0, days_since_refeed=30, carb_delta_g=0,
        )
        assert r.glycogen_swing_kg == pytest.approx(0.0, abs=0.05)
        assert r.refeed_offset_kg == pytest.approx(0.0, abs=0.05)
        # CI band barely wider than central
        assert (r.ci_high_kg - r.ci_low_kg) < 0.2

    def test_fresh_carb_load_raises_glycogen_swing(self):
        r = glycogen_water_overlay(
            central_kg=74.0, days_since_refeed=30, carb_delta_g=500,
        )
        assert r.glycogen_swing_kg > 0.5

    def test_fresh_carb_depletion_negative_swing(self):
        r = glycogen_water_overlay(
            central_kg=74.0, days_since_refeed=30, carb_delta_g=-500,
        )
        assert r.glycogen_swing_kg < -0.3

    def test_glycogen_decays_over_time(self):
        # Same carb delta but older → smaller effect. Easier to test via refeed offset.
        near = glycogen_water_overlay(
            central_kg=74.0, days_since_refeed=0, carb_delta_g=0,
        )
        far = glycogen_water_overlay(
            central_kg=74.0, days_since_refeed=14, carb_delta_g=0,
        )
        # Near refeed: sawtooth present; far refeed: decayed to near zero
        assert near.refeed_offset_kg > far.refeed_offset_kg

    def test_ci_invariant(self):
        # For any inputs: ci_low ≤ central ≤ ci_high
        for days, carb in [(0, 0), (0, 500), (10, -200), (30, 100)]:
            r = glycogen_water_overlay(
                central_kg=74.0, days_since_refeed=days, carb_delta_g=carb,
            )
            assert r.ci_low_kg <= 74.0
            assert 74.0 <= r.ci_high_kg

    def test_refeed_saturates_near_day_0(self):
        r0 = glycogen_water_overlay(
            central_kg=74.0, days_since_refeed=0, carb_delta_g=0,
        )
        r2 = glycogen_water_overlay(
            central_kg=74.0, days_since_refeed=2, carb_delta_g=0,
        )
        # Day 0 at full offset (up to 0.8 kg); day 2 roughly half-decayed
        assert r0.refeed_offset_kg > 0.5
        assert r2.refeed_offset_kg < r0.refeed_offset_kg
