"""Tests for Body Comp Stream — weight EMA smoothing and VDOT weight adjustment."""

from datetime import date

from training_engine.body_comp_stream import adjust_vdot_for_weight, compute_weight_ema


def test_weight_ema_basic():
    weights = [(date(2026, 3, i), 80.0) for i in range(1, 15)]
    ema = compute_weight_ema(weights, span=7)
    assert len(ema) == 14
    assert all(e["weight_ema"] == 80.0 for e in ema)  # constant = constant EMA


def test_weight_ema_smoothing():
    weights = [(date(2026, 3, i), 80.0 + (i % 3) - 1) for i in range(1, 15)]
    ema = compute_weight_ema(weights, span=7)
    # EMA should dampen daily oscillations
    raw_range = max(w for _, w in weights) - min(w for _, w in weights)
    ema_range = max(e["weight_ema"] for e in ema) - min(e["weight_ema"] for e in ema)
    assert ema_range < raw_range


def test_weight_ema_single():
    ema = compute_weight_ema([(date(2026, 3, 1), 80.0)])
    assert len(ema) == 1
    assert ema[0]["weight_ema"] == 80.0


def test_weight_ema_empty():
    assert compute_weight_ema([]) == []


def test_weight_ema_result_fields():
    """Each EMA entry should have all expected fields."""
    ema = compute_weight_ema([(date(2026, 3, 1), 80.5)])
    entry = ema[0]
    assert "date" in entry
    assert "weight_raw" in entry
    assert "weight_ema" in entry
    assert entry["date"] == date(2026, 3, 1)
    assert entry["weight_raw"] == 80.5


def test_weight_ema_trending_down():
    """EMA should lag behind a downward weight trend."""
    weights = [(date(2026, 3, i), 82.0 - i * 0.1) for i in range(1, 15)]
    ema = compute_weight_ema(weights, span=7)
    # EMA should be above raw weight for a downward trend (it lags)
    for entry in ema[2:]:  # skip first couple where EMA is initializing
        assert entry["weight_ema"] >= entry["weight_raw"]


def test_weight_ema_custom_span():
    """Shorter span should track raw data more closely."""
    weights = [(date(2026, 3, i), 80.0 + (i % 3) - 1) for i in range(1, 15)]
    ema_short = compute_weight_ema(weights, span=3)
    ema_long = compute_weight_ema(weights, span=14)
    # Shorter span EMA should have larger range (less smoothing)
    short_range = max(e["weight_ema"] for e in ema_short) - min(
        e["weight_ema"] for e in ema_short
    )
    long_range = max(e["weight_ema"] for e in ema_long) - min(
        e["weight_ema"] for e in ema_long
    )
    assert short_range > long_range


def test_vdot_weight_loss():
    adjusted = adjust_vdot_for_weight(47.0, 81.0, 80.0)
    assert adjusted > 47.0  # lighter = higher VDOT


def test_vdot_weight_gain():
    adjusted = adjust_vdot_for_weight(47.0, 81.0, 82.0)
    assert adjusted < 47.0  # heavier = lower VDOT


def test_vdot_no_change():
    adjusted = adjust_vdot_for_weight(47.0, 81.0, 81.0)
    assert adjusted == 47.0


def test_vdot_zero_weight():
    assert adjust_vdot_for_weight(47.0, 81.0, 0) == 47.0
    assert adjust_vdot_for_weight(47.0, 0, 80.0) == 47.0


def test_vdot_negative_weight():
    assert adjust_vdot_for_weight(47.0, 81.0, -5.0) == 47.0
    assert adjust_vdot_for_weight(47.0, -5.0, 80.0) == 47.0


def test_vdot_1kg_approx_1_point():
    """~1 kg loss at ~80 kg ~ 0.6 VDOT point."""
    adjusted = adjust_vdot_for_weight(47.0, 80.0, 79.0)
    delta = adjusted - 47.0
    assert 0.4 < delta < 0.8


def test_vdot_symmetry():
    """Weight gain should reduce VDOT by roughly the same magnitude as loss improves it."""
    gain = adjust_vdot_for_weight(47.0, 80.0, 81.0)
    loss = adjust_vdot_for_weight(47.0, 80.0, 79.0)
    delta_gain = 47.0 - gain
    delta_loss = loss - 47.0
    # Not perfectly symmetric (ratio-based), but close at small deltas
    assert abs(delta_gain - delta_loss) < 0.1
