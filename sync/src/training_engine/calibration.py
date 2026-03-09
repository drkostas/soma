"""
Personal Calibration Pipeline — 4-phase weight progression.

Evolves readiness signal weights from generic equal weights to personalized
weights as user data accumulates.

Phase 1 (<30 days):  Equal weights (Dawes 1979 — unit weights beat regression
                     in small samples)
Phase 2 (>=30 days): |Pearson r|-based weights — within-individual correlation
                     of each signal with session quality
Phase 3 (>=60 days): LASSO regression — sparse, regularised weights that
                     zero-out noise signals
Phase 4 (>=120 days): Kalman placeholder — currently falls through to LASSO

Research refs:
- Dawes 1979: Equal weights are robust in small-n
- Tibshirani 1996: LASSO for sparse feature selection
- Plews 2013: Individual HRV response varies widely
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from typing import Optional

import numpy as np

SIGNAL_NAMES: list[str] = ["hrv", "sleep", "rhr", "bb"]
EQUAL_WEIGHTS: dict[str, float] = {k: 0.25 for k in SIGNAL_NAMES}

# Mapping from z-score key names to signal names
_Z_TO_SIGNAL = {
    "hrv_z": "hrv",
    "sleep_z": "sleep",
    "rhr_z": "rhr",
    "bb_z": "bb",
}


@dataclass
class CalibrationState:
    """Persistent calibration state for a user."""

    phase: int
    data_days: int
    weights: dict[str, float]
    correlations: Optional[dict[str, float]] = None
    force_equal: bool = False


# ---------------------------------------------------------------------------
# Phase progression
# ---------------------------------------------------------------------------


def get_current_phase(data_days: int) -> int:
    """Return calibration phase based on available data days.

    Phase thresholds:
        <30  -> 1 (equal weights)
        >=30 -> 2 (correlation-based)
        >=60 -> 3 (LASSO)
        >=120 -> 4 (Kalman placeholder)
    """
    if data_days >= 120:
        return 4
    if data_days >= 60:
        return 3
    if data_days >= 30:
        return 2
    return 1


# ---------------------------------------------------------------------------
# Correlation-based weights (phase 2)
# ---------------------------------------------------------------------------


def compute_correlations(
    signals: dict[str, list[float]],
    session_quality: list[float],
) -> dict[str, float]:
    """Compute within-individual Pearson r between each signal and session quality.

    Args:
        signals: dict with keys "hrv_z", "sleep_z", "rhr_z", "bb_z", each
                 mapping to a list of floats (same length as session_quality).
        session_quality: list of quality scores (one per session/day).

    Returns:
        dict mapping signal name ("hrv", "sleep", "rhr", "bb") to r value.
        Requires >= 10 data points, else returns 0.0 for that signal.
    """
    result: dict[str, float] = {}

    for z_key, sig_name in _Z_TO_SIGNAL.items():
        values = signals.get(z_key, [])
        n = min(len(values), len(session_quality))

        if n < 10:
            result[sig_name] = 0.0
            continue

        x = values[:n]
        y = session_quality[:n]

        r = _pearson_r(x, y)
        result[sig_name] = r

    return result


def _pearson_r(x: list[float], y: list[float]) -> float:
    """Compute Pearson correlation coefficient between two lists."""
    n = len(x)
    if n == 0:
        return 0.0

    mean_x = sum(x) / n
    mean_y = sum(y) / n

    cov = sum((xi - mean_x) * (yi - mean_y) for xi, yi in zip(x, y))
    var_x = sum((xi - mean_x) ** 2 for xi in x)
    var_y = sum((yi - mean_y) ** 2 for yi in y)

    denom = math.sqrt(var_x * var_y)
    if denom == 0.0:
        return 0.0

    return cov / denom


def _abs_r_weights(correlations: dict[str, float]) -> dict[str, float]:
    """Convert |r| values to normalised weights summing to 1.0.

    If all individual |r| values are near zero (< 0.01), returns EQUAL_WEIGHTS.
    """
    abs_vals = {k: abs(v) for k, v in correlations.items()}
    total = sum(abs_vals.values())

    if all(v < 0.01 for v in abs_vals.values()):
        return dict(EQUAL_WEIGHTS)

    return {k: v / total for k, v in abs_vals.items()}


# ---------------------------------------------------------------------------
# LASSO weights (phase 3)
# ---------------------------------------------------------------------------


def compute_lasso_weights(
    X: np.ndarray,
    y: np.ndarray,
    alpha: float = 0.1,
) -> dict[str, float]:
    """Fit LASSO regression and return normalised absolute coefficient weights.

    Args:
        X: (n_samples, 4) array — columns correspond to SIGNAL_NAMES order.
        y: (n_samples,) quality array.
        alpha: LASSO regularisation strength.

    Returns:
        dict mapping signal name to weight (sums to 1.0).
        If all coefficients are zero, returns EQUAL_WEIGHTS.
    """
    from sklearn.linear_model import Lasso

    model = Lasso(alpha=alpha, max_iter=10000)
    model.fit(X, y)

    abs_coefs = np.abs(model.coef_)
    total = abs_coefs.sum()

    if total < 1e-10:
        return dict(EQUAL_WEIGHTS)

    normalised = abs_coefs / total
    return {name: float(normalised[i]) for i, name in enumerate(SIGNAL_NAMES)}


# ---------------------------------------------------------------------------
# Active weight selection
# ---------------------------------------------------------------------------


def get_active_weights(
    phase: int,
    correlations: Optional[dict[str, float]] = None,
    lasso_weights: Optional[dict[str, float]] = None,
    force_equal: bool = False,
) -> dict[str, float]:
    """Return the active weight set for the given calibration phase.

    Cascade logic:
        force_equal=True → always EQUAL_WEIGHTS
        Phase 1           → EQUAL_WEIGHTS
        Phase 2           → |r|-based from correlations (fallback: equal)
        Phase 3+          → LASSO (fallback: correlation, fallback: equal)
    """
    if force_equal:
        return dict(EQUAL_WEIGHTS)

    if phase <= 1:
        return dict(EQUAL_WEIGHTS)

    if phase == 2:
        if correlations is not None:
            return _abs_r_weights(correlations)
        return dict(EQUAL_WEIGHTS)

    # Phase 3 and 4
    if lasso_weights is not None:
        return dict(lasso_weights)
    if correlations is not None:
        return _abs_r_weights(correlations)
    return dict(EQUAL_WEIGHTS)


# ---------------------------------------------------------------------------
# DB-backed state management
# ---------------------------------------------------------------------------


def _ensure_table(conn) -> None:
    """No-op — table 'calibration_state' is defined in sync/schema.sql."""
    pass


def advance_calibration(conn, state: CalibrationState) -> CalibrationState:
    """Query DB for data count, advance phase, recompute weights, and persist.

    Steps:
        1. Ensure calibration_state table exists
        2. Count days with readiness data in daily_health_summary
        3. Determine new phase from data_days
        4. Recompute weights for the new phase (correlation/LASSO as available)
        5. Upsert state into calibration_state table

    Returns:
        Updated CalibrationState.
    """
    _ensure_table(conn)

    # Count data days from daily_health_summary
    with conn.cursor() as cur:
        cur.execute("""
            SELECT COUNT(DISTINCT date)
            FROM daily_health_summary
            WHERE avg_overnight_hrv IS NOT NULL
              AND sleep_time_seconds IS NOT NULL
              AND resting_heart_rate IS NOT NULL
        """)
        row = cur.fetchone()
        data_days = row[0] if row else 0

    new_phase = get_current_phase(data_days)

    # Determine active weights
    weights = get_active_weights(
        phase=new_phase,
        correlations=state.correlations,
        lasso_weights=None,  # LASSO computed externally when enough data
        force_equal=state.force_equal,
    )

    updated = CalibrationState(
        phase=new_phase,
        data_days=data_days,
        weights=weights,
        correlations=state.correlations,
        force_equal=state.force_equal,
    )

    # Persist
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO calibration_state (id, phase, data_days, weights, correlations, force_equal, updated_at)
            VALUES (1, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT (id)
            DO UPDATE SET
                phase = EXCLUDED.phase,
                data_days = EXCLUDED.data_days,
                weights = EXCLUDED.weights,
                correlations = EXCLUDED.correlations,
                force_equal = EXCLUDED.force_equal,
                updated_at = NOW()
        """, (
            updated.phase,
            updated.data_days,
            json.dumps(updated.weights),
            json.dumps(updated.correlations) if updated.correlations else None,
            updated.force_equal,
        ))
    conn.commit()

    return updated
