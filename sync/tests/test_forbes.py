"""Tests for Forbes partitioning + recomp multiplier (M3.1).

Research basis: V2 §8.1, Forbes 2000 FFM-FM curve.

dFFM/dBW = 10.4 / (10.4 + FM)

Recomp multiplier: 0.6× when ≥3 resistance sessions/week AND protein ≥1.8 g/kg
(concurrent RT + high protein partitions LESS fat, more lean relative to the
curve).
"""

import pytest

from nutrition_engine.forbes import ForbesResult, partition_weight_change


class TestForbesResultShape:
    def test_returns_dataclass(self):
        r = partition_weight_change(d_bw_kg=0.5, fm_kg=20.0)
        assert isinstance(r, ForbesResult)
        assert hasattr(r, "d_ffm_kg")
        assert hasattr(r, "d_fm_kg")
        assert hasattr(r, "ffm_fraction")


class TestDefaultPartitioning:
    def test_zero_change_is_zero_everywhere(self):
        r = partition_weight_change(d_bw_kg=0.0, fm_kg=20.0)
        assert r.d_ffm_kg == pytest.approx(0.0)
        assert r.d_fm_kg == pytest.approx(0.0)

    def test_gain_at_fm_20(self):
        # 10.4 / (10.4 + 20) = 0.342
        r = partition_weight_change(d_bw_kg=1.0, fm_kg=20.0)
        assert r.ffm_fraction == pytest.approx(10.4 / 30.4, rel=1e-6)
        assert r.d_ffm_kg == pytest.approx(10.4 / 30.4)
        assert r.d_fm_kg == pytest.approx(1.0 - 10.4 / 30.4)

    def test_loss_at_fm_10(self):
        # 10.4 / (10.4 + 10) = 0.510
        r = partition_weight_change(d_bw_kg=-1.0, fm_kg=10.0)
        assert r.ffm_fraction == pytest.approx(10.4 / 20.4, rel=1e-6)
        # Loss splits same way: more FFM lost at lower FM (the classic cut warning).
        assert r.d_ffm_kg == pytest.approx(-10.4 / 20.4)
        assert r.d_fm_kg == pytest.approx(-1.0 + 10.4 / 20.4)

    def test_extreme_high_fm_gives_mostly_fat(self):
        # At fm=90 kg, ffm fraction ≈ 0.104
        r = partition_weight_change(d_bw_kg=1.0, fm_kg=90.0)
        assert r.ffm_fraction < 0.12
        assert r.d_fm_kg > r.d_ffm_kg

    def test_extreme_low_fm_gives_mostly_ffm(self):
        # At fm=3 kg (very lean), ffm fraction ≈ 0.776
        r = partition_weight_change(d_bw_kg=1.0, fm_kg=3.0)
        assert r.ffm_fraction > 0.7
        assert r.d_ffm_kg > r.d_fm_kg


class TestRecompMultiplier:
    def test_recomp_shrinks_ffm_fraction(self):
        base = partition_weight_change(d_bw_kg=1.0, fm_kg=20.0, recomp=False)
        rec = partition_weight_change(d_bw_kg=1.0, fm_kg=20.0, recomp=True)
        assert rec.ffm_fraction == pytest.approx(base.ffm_fraction * 0.6, rel=1e-6)
        assert rec.d_ffm_kg < base.d_ffm_kg

    def test_recomp_keeps_invariant(self):
        r = partition_weight_change(d_bw_kg=1.0, fm_kg=20.0, recomp=True)
        assert r.d_ffm_kg + r.d_fm_kg == pytest.approx(1.0)


class TestInvariant:
    @pytest.mark.parametrize("d_bw", [-2.0, -0.5, 0.0, 0.5, 2.0])
    @pytest.mark.parametrize("fm", [5.0, 15.0, 30.0, 60.0])
    @pytest.mark.parametrize("recomp", [False, True])
    def test_ffm_plus_fm_equals_bw(self, d_bw: float, fm: float, recomp: bool):
        r = partition_weight_change(d_bw_kg=d_bw, fm_kg=fm, recomp=recomp)
        assert r.d_ffm_kg + r.d_fm_kg == pytest.approx(d_bw, abs=1e-9)


class TestGuards:
    def test_negative_fm_raises(self):
        with pytest.raises(ValueError):
            partition_weight_change(d_bw_kg=1.0, fm_kg=-5.0)
