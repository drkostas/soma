"""Tests for Personal Calibration Pipeline — 4-phase weight progression."""

import math

import numpy as np
import pytest

from training_engine.calibration import (
    EQUAL_WEIGHTS,
    SIGNAL_NAMES,
    CalibrationState,
    _abs_r_weights,
    compute_correlations,
    compute_lasso_weights,
    get_active_weights,
    get_current_phase,
)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------


def test_signal_names():
    """SIGNAL_NAMES should contain the 4 biometric signals."""
    assert SIGNAL_NAMES == ["hrv", "sleep", "rhr", "bb"]


def test_equal_weights_values():
    """EQUAL_WEIGHTS should be exactly 0.25 each, summing to 1.0."""
    assert EQUAL_WEIGHTS == {"hrv": 0.25, "sleep": 0.25, "rhr": 0.25, "bb": 0.25}
    assert sum(EQUAL_WEIGHTS.values()) == 1.0


# ---------------------------------------------------------------------------
# CalibrationState dataclass
# ---------------------------------------------------------------------------


def test_calibration_state_defaults():
    """CalibrationState should have correct defaults."""
    state = CalibrationState(phase=1, data_days=10, weights=EQUAL_WEIGHTS)
    assert state.phase == 1
    assert state.data_days == 10
    assert state.weights == EQUAL_WEIGHTS
    assert state.correlations is None
    assert state.force_equal is False


def test_calibration_state_with_correlations():
    """CalibrationState should accept optional correlations."""
    corrs = {"hrv": 0.5, "sleep": 0.3, "rhr": -0.2, "bb": 0.4}
    state = CalibrationState(
        phase=2, data_days=35, weights=EQUAL_WEIGHTS, correlations=corrs
    )
    assert state.correlations == corrs


def test_calibration_state_force_equal():
    """CalibrationState force_equal toggle."""
    state = CalibrationState(
        phase=3, data_days=70, weights=EQUAL_WEIGHTS, force_equal=True
    )
    assert state.force_equal is True


# ---------------------------------------------------------------------------
# Phase progression
# ---------------------------------------------------------------------------


def test_phase_1_under_30():
    """< 30 days -> phase 1."""
    assert get_current_phase(0) == 1
    assert get_current_phase(15) == 1
    assert get_current_phase(29) == 1


def test_phase_2_at_30():
    """>= 30 days -> phase 2."""
    assert get_current_phase(30) == 2
    assert get_current_phase(45) == 2
    assert get_current_phase(59) == 2


def test_phase_3_at_60():
    """>= 60 days -> phase 3."""
    assert get_current_phase(60) == 3
    assert get_current_phase(90) == 3
    assert get_current_phase(119) == 3


def test_phase_4_at_120():
    """>= 120 days -> phase 4."""
    assert get_current_phase(120) == 4
    assert get_current_phase(365) == 4


# ---------------------------------------------------------------------------
# Equal weights (phase 1)
# ---------------------------------------------------------------------------


def test_phase_1_returns_equal_weights():
    """Phase 1 returns exactly {hrv: 0.25, sleep: 0.25, rhr: 0.25, bb: 0.25}."""
    weights = get_active_weights(phase=1)
    assert weights == {"hrv": 0.25, "sleep": 0.25, "rhr": 0.25, "bb": 0.25}


# ---------------------------------------------------------------------------
# Correlations
# ---------------------------------------------------------------------------


def test_correlations_positive():
    """Computes positive Pearson r for positively correlated signal."""
    n = 40
    np.random.seed(42)
    quality = np.random.randn(n).tolist()
    signals = {
        "hrv_z": [q * 0.8 + np.random.randn() * 0.2 for q in quality],
        "sleep_z": [np.random.randn() for _ in range(n)],
        "rhr_z": [np.random.randn() for _ in range(n)],
        "bb_z": [np.random.randn() for _ in range(n)],
    }
    corrs = compute_correlations(signals, quality)
    # hrv_z is strongly correlated with quality
    assert corrs["hrv"] > 0.5
    # Others should be near zero (random)
    for key in ["sleep", "rhr", "bb"]:
        assert abs(corrs[key]) < 0.5


def test_correlations_negative():
    """Computes negative Pearson r for negatively correlated signal."""
    n = 50
    np.random.seed(99)
    quality = np.random.randn(n).tolist()
    signals = {
        "hrv_z": [np.random.randn() for _ in range(n)],
        "sleep_z": [np.random.randn() for _ in range(n)],
        "rhr_z": [-q * 0.9 + np.random.randn() * 0.1 for q in quality],
        "bb_z": [np.random.randn() for _ in range(n)],
    }
    corrs = compute_correlations(signals, quality)
    assert corrs["rhr"] < -0.5


def test_correlations_insufficient_data():
    """With < 10 data points, correlations default to 0.0."""
    signals = {
        "hrv_z": [1.0, 2.0, 3.0],
        "sleep_z": [1.0, 2.0, 3.0],
        "rhr_z": [1.0, 2.0, 3.0],
        "bb_z": [1.0, 2.0, 3.0],
    }
    quality = [1.0, 2.0, 3.0]
    corrs = compute_correlations(signals, quality)
    for key in SIGNAL_NAMES:
        assert corrs[key] == 0.0


def test_correlation_weights_sum_to_one():
    """Weights from correlations sum to 1.0."""
    n = 35
    np.random.seed(123)
    quality = np.random.randn(n).tolist()
    signals = {
        "hrv_z": [q * 0.6 + np.random.randn() * 0.4 for q in quality],
        "sleep_z": [q * 0.3 + np.random.randn() * 0.7 for q in quality],
        "rhr_z": [-q * 0.4 + np.random.randn() * 0.6 for q in quality],
        "bb_z": [q * 0.2 + np.random.randn() * 0.8 for q in quality],
    }
    corrs = compute_correlations(signals, quality)
    weights = _abs_r_weights(corrs)
    assert abs(sum(weights.values()) - 1.0) < 1e-9
    for v in weights.values():
        assert v >= 0.0


# ---------------------------------------------------------------------------
# _abs_r_weights
# ---------------------------------------------------------------------------


def test_abs_r_weights_all_zero():
    """All-zero correlations return EQUAL_WEIGHTS."""
    corrs = {"hrv": 0.0, "sleep": 0.0, "rhr": 0.0, "bb": 0.0}
    assert _abs_r_weights(corrs) == EQUAL_WEIGHTS


def test_abs_r_weights_near_zero():
    """Near-zero correlations (all < 0.01) return EQUAL_WEIGHTS."""
    corrs = {"hrv": 0.005, "sleep": -0.003, "rhr": 0.002, "bb": -0.001}
    assert _abs_r_weights(corrs) == EQUAL_WEIGHTS


def test_abs_r_weights_one_dominant():
    """One dominant signal gets the largest weight."""
    corrs = {"hrv": 0.8, "sleep": 0.1, "rhr": 0.1, "bb": 0.1}
    weights = _abs_r_weights(corrs)
    assert weights["hrv"] > weights["sleep"]
    assert weights["hrv"] > weights["rhr"]
    assert weights["hrv"] > weights["bb"]
    assert abs(sum(weights.values()) - 1.0) < 1e-9


def test_abs_r_weights_negative_correlations():
    """Negative correlations are treated by absolute value."""
    corrs = {"hrv": -0.6, "sleep": 0.3, "rhr": -0.1, "bb": 0.0}
    weights = _abs_r_weights(corrs)
    # hrv has highest |r| = 0.6
    assert weights["hrv"] > weights["sleep"]
    assert abs(sum(weights.values()) - 1.0) < 1e-9


# ---------------------------------------------------------------------------
# LASSO weights
# ---------------------------------------------------------------------------


def test_lasso_weights_sum_to_one():
    """LASSO weights sum to 1.0."""
    np.random.seed(42)
    n = 100
    X = np.random.randn(n, 4)
    # y strongly depends on column 0 (hrv) and column 2 (rhr)
    y = 2.0 * X[:, 0] + 1.5 * X[:, 2] + np.random.randn(n) * 0.1
    weights = compute_lasso_weights(X, y, alpha=0.1)
    assert abs(sum(weights.values()) - 1.0) < 1e-9


def test_lasso_strongest_signal_highest_weight():
    """Signal with strongest true relationship gets highest weight."""
    np.random.seed(7)
    n = 200
    X = np.random.randn(n, 4)
    # y depends only on column 1 (sleep)
    y = 3.0 * X[:, 1] + np.random.randn(n) * 0.1
    weights = compute_lasso_weights(X, y, alpha=0.01)
    assert weights["sleep"] > weights["hrv"]
    assert weights["sleep"] > weights["rhr"]
    assert weights["sleep"] > weights["bb"]


def test_lasso_all_zero_coefficients():
    """If all coefficients are zero (high alpha), fall back to EQUAL_WEIGHTS."""
    np.random.seed(42)
    n = 50
    X = np.random.randn(n, 4)
    y = np.random.randn(n)  # no relationship
    weights = compute_lasso_weights(X, y, alpha=100.0)
    assert weights == EQUAL_WEIGHTS


def test_lasso_four_weights_returned():
    """LASSO returns exactly 4 weights for the 4 signals."""
    np.random.seed(42)
    n = 80
    X = np.random.randn(n, 4)
    y = X[:, 0] + np.random.randn(n) * 0.5
    weights = compute_lasso_weights(X, y)
    assert set(weights.keys()) == set(SIGNAL_NAMES)


# ---------------------------------------------------------------------------
# get_active_weights
# ---------------------------------------------------------------------------


def test_active_weights_phase1():
    """Phase 1 always returns equal weights."""
    assert get_active_weights(1) == EQUAL_WEIGHTS


def test_active_weights_phase2_with_correlations():
    """Phase 2 uses |r|-based weights from correlations."""
    corrs = {"hrv": 0.6, "sleep": 0.3, "rhr": 0.05, "bb": 0.05}
    weights = get_active_weights(2, correlations=corrs)
    assert weights["hrv"] > weights["sleep"]
    assert abs(sum(weights.values()) - 1.0) < 1e-9


def test_active_weights_phase2_no_correlations_fallback():
    """Phase 2 without correlations falls back to equal weights."""
    weights = get_active_weights(2, correlations=None)
    assert weights == EQUAL_WEIGHTS


def test_active_weights_phase3_with_lasso():
    """Phase 3 uses LASSO weights when available."""
    lasso_w = {"hrv": 0.5, "sleep": 0.3, "rhr": 0.15, "bb": 0.05}
    weights = get_active_weights(3, lasso_weights=lasso_w)
    assert weights == lasso_w


def test_active_weights_phase3_fallback_to_correlations():
    """Phase 3 without LASSO falls back to correlation-based weights."""
    corrs = {"hrv": 0.7, "sleep": 0.2, "rhr": 0.05, "bb": 0.05}
    weights = get_active_weights(3, correlations=corrs, lasso_weights=None)
    assert weights["hrv"] > weights["sleep"]
    assert abs(sum(weights.values()) - 1.0) < 1e-9


def test_active_weights_phase3_fallback_to_equal():
    """Phase 3 without LASSO or correlations falls back to equal."""
    weights = get_active_weights(3)
    assert weights == EQUAL_WEIGHTS


def test_active_weights_phase4_uses_lasso():
    """Phase 4 also uses LASSO weights (Kalman placeholder)."""
    lasso_w = {"hrv": 0.4, "sleep": 0.35, "rhr": 0.15, "bb": 0.1}
    weights = get_active_weights(4, lasso_weights=lasso_w)
    assert weights == lasso_w


# ---------------------------------------------------------------------------
# Force equal toggle
# ---------------------------------------------------------------------------


def test_force_equal_phase1():
    """force_equal=True with phase 1 returns equal."""
    assert get_active_weights(1, force_equal=True) == EQUAL_WEIGHTS


def test_force_equal_phase2():
    """force_equal=True overrides phase 2 correlation-based weights."""
    corrs = {"hrv": 0.8, "sleep": 0.1, "rhr": 0.05, "bb": 0.05}
    weights = get_active_weights(2, correlations=corrs, force_equal=True)
    assert weights == EQUAL_WEIGHTS


def test_force_equal_phase3():
    """force_equal=True overrides phase 3 LASSO weights."""
    lasso_w = {"hrv": 0.6, "sleep": 0.2, "rhr": 0.15, "bb": 0.05}
    weights = get_active_weights(3, lasso_weights=lasso_w, force_equal=True)
    assert weights == EQUAL_WEIGHTS


def test_force_equal_phase4():
    """force_equal=True overrides phase 4 as well."""
    lasso_w = {"hrv": 0.5, "sleep": 0.3, "rhr": 0.1, "bb": 0.1}
    weights = get_active_weights(4, lasso_weights=lasso_w, force_equal=True)
    assert weights == EQUAL_WEIGHTS
