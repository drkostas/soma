"""Tests for M4 Phase A — Macro Engine core (5-band × tier × mode).

Research basis: V2 §2.

M4.1 Load classifier:
    run_load = run_kcal / (weight × 10)
    gym_load = gym_kcal / (weight × 6)
    total_load = min(run_load + gym_load, 4.0)
    if run_load ≥ 1.5: total_load = run_load  (endurance priority)
Band thresholds:
    REST: load == 0
    LIGHT: (0, 1.0]
    MODERATE: (1.0, 2.0]
    HARD: (2.0, 3.0]
    VERY_HARD: > 3.0

M4.2 Protein matrix + very_hard modifier (0.2 g/kg drop, floor 1.6).
M4.3 Carbs: rest 3.0 / light 3.5 / moderate 5.0 / hard 6.5 / very_hard 8.0 g/kg.
     Fiber: max(25, round(kcal × 14/1000)) + 5 cut_bonus; hard ceiling 60g.
M4.4 Orchestrator: applies fat floor from M1.5; kcal fills remainder.
"""

import pytest

from nutrition_engine.macro_targets import (
    Band,
    MacroTargets,
    carb_g_per_kg,
    carb_target_g,
    classify_band,
    compute_macro_targets,
    compute_training_load,
    fiber_target_g,
    protein_g_per_kg,
)
from nutrition_engine.mode import Mode
from nutrition_engine.tier import Tier


# ---------------------------------------------------------------------------
# M4.1 Load classifier
# ---------------------------------------------------------------------------


class TestTrainingLoad:
    def test_zero_zero_is_zero(self):
        assert compute_training_load(0, 0, weight_kg=74) == 0

    def test_short_run(self):
        # 400 kcal at 74 kg → run_load = 400/740 ≈ 0.54
        load = compute_training_load(400, 0, weight_kg=74)
        assert 0.5 <= load <= 0.6

    def test_endurance_priority(self):
        # run_load ≥ 1.5 → ignore gym, use run_load only
        # 1200 kcal at 74 kg → run_load ≈ 1.62
        load = compute_training_load(1200, 300, weight_kg=74)
        assert abs(load - (1200 / 740)) < 0.01

    def test_saturation_cap(self):
        # Gym-heavy day below the endurance-priority threshold: 500 run (load
        # 0.68) + 2500 gym (load 5.63) would sum to 6.31 → cap 4.0.
        load = compute_training_load(500, 2500, weight_kg=74)
        assert load == 4.0

    def test_gym_only(self):
        # 400 kcal gym at 74 kg → gym_load = 400/444 ≈ 0.9
        load = compute_training_load(0, 400, weight_kg=74)
        assert 0.85 <= load <= 0.95

    def test_negative_kcal_raises(self):
        with pytest.raises(ValueError):
            compute_training_load(-1, 0, weight_kg=74)


class TestClassifyBand:
    def test_rest(self):
        assert classify_band(0) == Band.REST

    def test_light(self):
        assert classify_band(0.5) == Band.LIGHT
        assert classify_band(1.0) == Band.LIGHT

    def test_moderate(self):
        assert classify_band(1.01) == Band.MODERATE
        assert classify_band(2.0) == Band.MODERATE

    def test_hard(self):
        assert classify_band(2.01) == Band.HARD
        assert classify_band(3.0) == Band.HARD

    def test_very_hard(self):
        assert classify_band(3.01) == Band.VERY_HARD
        assert classify_band(4.0) == Band.VERY_HARD


# ---------------------------------------------------------------------------
# M4.2 Protein formula
# ---------------------------------------------------------------------------


class TestProtein:
    def test_standard_t2_moderate(self):
        # Our target: 2.3 g/kg at T2 Standard
        p = protein_g_per_kg(Tier.T2, Mode.STANDARD, Band.MODERATE)
        assert p == pytest.approx(2.3)

    def test_aggressive_t2_hard(self):
        p = protein_g_per_kg(Tier.T2, Mode.AGGRESSIVE, Band.HARD)
        assert p == pytest.approx(2.4)

    def test_very_hard_drops_by_0_2(self):
        base = protein_g_per_kg(Tier.T2, Mode.AGGRESSIVE, Band.HARD)
        vh = protein_g_per_kg(Tier.T2, Mode.AGGRESSIVE, Band.VERY_HARD)
        assert vh == pytest.approx(base - 0.2)

    def test_very_hard_respects_1_6_floor(self):
        # Bulk at T2 = 2.0 baseline; VERY_HARD → 1.8. Still ≥ 1.6 floor.
        p = protein_g_per_kg(Tier.T2, Mode.BULK, Band.VERY_HARD)
        assert p >= 1.6

    def test_maintenance_flat_2_0(self):
        for tier in [Tier.T1, Tier.T2, Tier.T3, Tier.T4]:
            p = protein_g_per_kg(tier, Mode.MAINTENANCE, Band.MODERATE)
            assert p == pytest.approx(2.0)

    def test_bulk_flat_2_0(self):
        p = protein_g_per_kg(Tier.T2, Mode.BULK, Band.MODERATE)
        assert p == pytest.approx(2.0)

    def test_injured_uses_standard_matrix(self):
        # Injured is allowed at all tiers; fall back to Standard matrix
        inj = protein_g_per_kg(Tier.T2, Mode.INJURED, Band.MODERATE)
        std = protein_g_per_kg(Tier.T2, Mode.STANDARD, Band.MODERATE)
        assert inj == pytest.approx(std)

    def test_every_combo_non_negative(self):
        for tier in Tier:
            for mode in Mode:
                for band in Band:
                    p = protein_g_per_kg(tier, mode, band)
                    assert p >= 1.6


# ---------------------------------------------------------------------------
# M4.3 Carbs + fiber
# ---------------------------------------------------------------------------


class TestCarbs:
    @pytest.mark.parametrize("band,expected", [
        (Band.REST, 3.0),
        (Band.LIGHT, 3.5),
        (Band.MODERATE, 5.0),
        (Band.HARD, 6.5),
        (Band.VERY_HARD, 8.0),
    ])
    def test_g_per_kg_by_band(self, band: Band, expected: float):
        assert carb_g_per_kg(band) == pytest.approx(expected)

    def test_target_by_band_and_weight(self):
        # 74 kg × HARD (6.5) = 481 g
        assert carb_target_g(Band.HARD, weight_kg=74.0, in_deficit=True) == 481

    def test_rest_deficit_health_floor(self):
        # REST × 74 kg = 222 g already > 100g floor
        # Test a lighter user where the floor bites: 30 kg × 3.0 = 90g → should be 100
        assert carb_target_g(Band.REST, weight_kg=30.0, in_deficit=True) == 100

    def test_rest_no_deficit_allows_below_100(self):
        # Not in deficit → health floor doesn't apply
        assert carb_target_g(Band.REST, weight_kg=30.0, in_deficit=False) == 90

    def test_health_floor_only_on_rest(self):
        # HARD band at 30kg = 195g, already above 100, floor no-op
        assert carb_target_g(Band.HARD, weight_kg=30.0, in_deficit=True) == 195


class TestFiber:
    def test_base_formula(self):
        # 2500 kcal × 14/1000 = 35; no deficit → 35
        assert fiber_target_g(2500, in_deficit=False) == 35

    def test_deficit_adds_5g(self):
        assert fiber_target_g(2500, in_deficit=True) == 40

    def test_min_25g(self):
        # 1000 kcal × 14/1000 = 14; clamped to 25
        assert fiber_target_g(1000, in_deficit=False) == 25

    def test_min_applies_before_cut_bonus(self):
        # 1000 kcal in deficit → max(25, 14) + 5 = 30
        assert fiber_target_g(1000, in_deficit=True) == 30

    def test_hard_ceiling_60(self):
        # 10000 kcal × 14/1000 = 140 + 5 → clamp 60
        assert fiber_target_g(10000, in_deficit=True) == 60


# ---------------------------------------------------------------------------
# M4.4 Composed macro engine
# ---------------------------------------------------------------------------


class TestComposedMacroEngine:
    def test_returns_targets_dataclass(self):
        r = compute_macro_targets(
            weight_kg=74.0, tier=Tier.T2, mode=Mode.STANDARD,
            band=Band.MODERATE, kcal_target=2000, in_deficit=True,
        )
        assert isinstance(r, MacroTargets)
        assert all(getattr(r, f) >= 0 for f in ["kcal", "protein_g", "carbs_g", "fat_g", "fiber_g"])

    def test_user_aggressive_hard(self):
        # Our profile: 74.2 kg T2 Aggressive HARD, 2000 kcal target.
        # At this kcal budget the engine can't hit both the HARD band carb
        # target (482g) AND the fat soft floor (59g) AND protein (178g),
        # so carbs flex DOWN from the band ceiling — that's the correct
        # signal that kcal is tight for the chosen band.
        r = compute_macro_targets(
            weight_kg=74.2, tier=Tier.T2, mode=Mode.AGGRESSIVE,
            band=Band.HARD, kcal_target=2000, in_deficit=True,
        )
        assert r.protein_g == 178
        # Carbs below band ceiling (482) but above health floor (100 applies
        # on REST only; HARD band has no floor).
        assert r.carbs_g <= 482
        # Fat ≥ hard floor 0.6 × 74.2 = 44.5g → 45g
        assert r.fat_g >= 45

    def test_kcal_balance_within_rounding(self):
        # protein×4 + carbs×4 + fat×9 ≈ kcal_target (within a few kcal from rounding)
        r = compute_macro_targets(
            weight_kg=74.0, tier=Tier.T2, mode=Mode.STANDARD,
            band=Band.MODERATE, kcal_target=2400, in_deficit=True,
        )
        total = r.protein_g * 4 + r.carbs_g * 4 + r.fat_g * 9
        assert abs(total - 2400) <= 10

    def test_fat_hard_floor_enforced(self):
        # Aggressive cut at 1500 kcal — fat remainder would be negative without
        # the hard floor. Engine must still hit fat ≥ 0.6 × weight.
        r = compute_macro_targets(
            weight_kg=74.0, tier=Tier.T2, mode=Mode.AGGRESSIVE,
            band=Band.VERY_HARD, kcal_target=1500, in_deficit=True,
        )
        assert r.fat_g >= round(0.6 * 74.0)

    def test_rest_day_standard(self):
        # Rest day at 2000 kcal — budget tight, so carbs flex down from band
        # ceiling (222g) but stay ≥ health floor (100g) thanks to in_deficit.
        r = compute_macro_targets(
            weight_kg=74.0, tier=Tier.T2, mode=Mode.STANDARD,
            band=Band.REST, kcal_target=2000, in_deficit=True,
        )
        # Protein: 2.3 × 74 = 170
        assert r.protein_g == 170
        # Carbs ≤ band ceiling, ≥ health floor 100
        assert 100 <= r.carbs_g <= 222

    def test_rest_day_maintenance_hits_band_ceiling(self):
        # With plenty of kcal headroom, rest-day carbs hit the band ceiling.
        r = compute_macro_targets(
            weight_kg=74.0, tier=Tier.T2, mode=Mode.MAINTENANCE,
            band=Band.REST, kcal_target=2800, in_deficit=False,
        )
        # Band ceiling 3.0 × 74 = 222g
        assert r.carbs_g == 222

    def test_maintenance_fat_target_above_floor(self):
        # Maintenance targets fat 1.0 g/kg (V2 §2.2) — engine should prefer
        # that over the 0.8 soft floor when calories allow.
        r = compute_macro_targets(
            weight_kg=74.0, tier=Tier.T2, mode=Mode.MAINTENANCE,
            band=Band.MODERATE, kcal_target=2800, in_deficit=False,
        )
        assert r.fat_g >= round(1.0 * 74.0) - 3  # allow small rounding slack

    def test_protein_never_below_1_6(self):
        # Extreme case: VERY_HARD carb priority could drop protein. Floor at 1.6.
        r = compute_macro_targets(
            weight_kg=74.0, tier=Tier.T2, mode=Mode.BULK,
            band=Band.VERY_HARD, kcal_target=3000, in_deficit=False,
        )
        assert r.protein_g >= round(1.6 * 74.0)
