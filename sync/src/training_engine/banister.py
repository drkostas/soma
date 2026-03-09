"""Banister impulse-response model for personalized PMC time constants.

Fits fitness (tau1) and fatigue (tau2) decay constants from actual run history
using maximal-effort anchor detection and differential evolution optimization.

The classic Banister model:
    p(t) = p0 + k1 * sum(w(i) * exp(-(t-i)/tau1)) - k2 * sum(w(i) * exp(-(t-i)/tau2))

Where:
    p0    = baseline performance (VDOT)
    k1    = fitness gain coefficient
    k2    = fatigue gain coefficient
    tau1  = fitness decay time constant (days, typically ~42)
    tau2  = fatigue decay time constant (days, typically ~7)
    w(i)  = training load on day i

References:
    - Banister, E.W. (1991). "Modeling elite athletic performance."
    - Busso, T. (2003). "Variable dose-response relationship between
      exercise training and performance."
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from typing import List, Tuple

from training_engine.vdot import vdot_from_race


@dataclass
class BanisterParams:
    """Fitted Banister model parameters."""
    p0: float     # baseline VDOT
    k1: float     # fitness gain coefficient
    k2: float     # fatigue gain coefficient
    tau1: float   # fitness decay time constant (days)
    tau2: float   # fatigue decay time constant (days)


# Default parameters when insufficient data for fitting
_DEFAULT_PARAMS = BanisterParams(p0=45.0, k1=0.05, k2=0.08, tau1=42, tau2=7)


def detect_anchor_runs(
    runs: list[dict],
    estimated_hrmax: float,
    hr_threshold_pct: float = 0.90,
    min_distance_m: float = 2000,
) -> list[dict]:
    """Detect maximal-effort anchor runs for Banister model calibration.

    Filters runs where avg_hr >= threshold % of HRmax AND distance >= min_distance.
    Computes VDOT for each qualifying run via the Daniels/Gilbert equation.

    Args:
        runs: List of run dicts with keys: date, avg_hr, distance_m, duration_s.
        estimated_hrmax: Estimated maximum heart rate (bpm).
        hr_threshold_pct: Minimum avg_hr / HRmax fraction (default 0.90).
        min_distance_m: Minimum distance in meters (default 2000).

    Returns:
        List of anchor dicts sorted by date, each containing the original
        run fields plus a computed 'vdot' value.
    """
    hr_cutoff = estimated_hrmax * hr_threshold_pct
    anchors = []

    for run in runs:
        avg_hr = run.get("avg_hr", 0)
        distance_m = run.get("distance_m", 0)
        duration_s = run.get("duration_s", 0)

        if avg_hr < hr_cutoff:
            continue
        if distance_m < min_distance_m:
            continue
        if duration_s <= 0:
            continue

        vdot = vdot_from_race(distance_m, duration_s)
        anchor = {**run, "vdot": vdot}
        anchors.append(anchor)

    anchors.sort(key=lambda a: a["date"])
    return anchors


def banister_predict(
    params: BanisterParams,
    daily_loads: list[tuple[int, float]],
    target_day: int,
) -> float:
    """Predict performance (VDOT) at a target day using the Banister model.

    p(t) = p0 + k1 * sum(w(i) * exp(-(t-i)/tau1)) - k2 * sum(w(i) * exp(-(t-i)/tau2))

    Args:
        params: BanisterParams with model coefficients.
        daily_loads: List of (day_index, load_value) tuples.
        target_day: Day index to predict performance at.

    Returns:
        Predicted VDOT score.
    """
    fitness_sum = 0.0
    fatigue_sum = 0.0

    for day_i, load in daily_loads:
        dt = target_day - day_i
        if dt <= 0:
            continue
        fitness_sum += load * math.exp(-dt / params.tau1)
        fatigue_sum += load * math.exp(-dt / params.tau2)

    return params.p0 + params.k1 * fitness_sum - params.k2 * fatigue_sum


def fit_banister(
    daily_loads: list[tuple[int, float]],
    anchors: list[dict],
    max_iterations: int = 1000,
) -> BanisterParams:
    """Fit Banister model parameters using differential evolution.

    Minimizes sum of squared errors between predicted and observed VDOT
    at anchor points. If fewer than 2 anchors are available, returns
    sensible defaults (tau1=42, tau2=7).

    Args:
        daily_loads: List of (day_index, load_value) tuples.
        anchors: List of dicts with 'day_index' and 'vdot' keys.
        max_iterations: Maximum iterations for differential evolution.

    Returns:
        Fitted BanisterParams.
    """
    if len(anchors) < 2:
        return BanisterParams(
            p0=_DEFAULT_PARAMS.p0,
            k1=_DEFAULT_PARAMS.k1,
            k2=_DEFAULT_PARAMS.k2,
            tau1=_DEFAULT_PARAMS.tau1,
            tau2=_DEFAULT_PARAMS.tau2,
        )

    from scipy.optimize import differential_evolution

    # Bounds: p0, k1, k2, tau1, tau2
    bounds = [
        (35, 55),       # p0: baseline VDOT
        (0.001, 5),     # k1: fitness gain
        (0.001, 10),    # k2: fatigue gain
        (20, 80),       # tau1: fitness decay (days)
        (3, 20),        # tau2: fatigue decay (days)
    ]

    def objective(x):
        p = BanisterParams(p0=x[0], k1=x[1], k2=x[2], tau1=x[3], tau2=x[4])
        sse = 0.0
        for anchor in anchors:
            predicted = banister_predict(p, daily_loads, anchor["day_index"])
            sse += (predicted - anchor["vdot"]) ** 2
        return sse

    result = differential_evolution(
        objective,
        bounds,
        maxiter=max_iterations,
        seed=42,
        tol=1e-8,
        polish=True,
    )

    return BanisterParams(
        p0=result.x[0],
        k1=result.x[1],
        k2=result.x[2],
        tau1=result.x[3],
        tau2=result.x[4],
    )


def load_anchors_from_db(conn, estimated_hrmax: float = 190) -> list[dict]:
    """Load anchor runs from garmin_activity_raw database table.

    Queries running activities from the 'summary' endpoint, extracts avg_hr,
    distance, and duration from the JSONB data, then filters through
    detect_anchor_runs().

    Args:
        conn: psycopg2 database connection.
        estimated_hrmax: Estimated maximum heart rate.

    Returns:
        List of anchor dicts with date, day_index, and vdot.
    """
    with conn.cursor() as cur:
        cur.execute("""
            SELECT activity_id, raw_json
            FROM garmin_activity_raw
            WHERE endpoint_name = 'summary'
              AND raw_json->'activityType'->>'typeKey' = 'running'
            ORDER BY (raw_json->>'startTimeLocal')::date ASC
        """)
        rows = cur.fetchall()

    runs = []
    for activity_id, raw_json in rows:
        data = raw_json if isinstance(raw_json, dict) else json.loads(raw_json)

        avg_hr = data.get("averageHR")
        distance_m = data.get("distance")
        duration_s = data.get("duration")
        start_local = data.get("startTimeLocal", "")

        if not all([avg_hr, distance_m, duration_s, start_local]):
            continue

        # Extract date string (first 10 chars of ISO timestamp)
        date_str = str(start_local)[:10]
        runs.append({
            "date": date_str,
            "avg_hr": float(avg_hr),
            "distance_m": float(distance_m),
            "duration_s": float(duration_s),
            "activity_id": activity_id,
        })

    return detect_anchor_runs(runs, estimated_hrmax=estimated_hrmax)


def _load_daily_loads_from_db(conn) -> tuple[list[tuple[int, float]], str]:
    """Load daily training loads from the training_load table (same source as PMC).

    Applies the same cross-modal scaling as compute_and_store_pmc() in
    load_stream.py so that the Banister model is fitted on the identical
    load signal used for CTL/ATL/TSB.

    Returns (daily_loads, min_date_str).
    """
    from datetime import timedelta
    from training_engine.load_stream import _cross_modal_scale

    with conn.cursor() as cur:
        cur.execute("""
            SELECT activity_date, source, load_value
            FROM training_load
            ORDER BY activity_date
        """)
        rows = cur.fetchall()

    if not rows:
        return [], ""

    # Aggregate daily load with cross-modal scaling (mirrors compute_and_store_pmc)
    load_by_date: dict = {}
    for activity_date, source, load_value in rows:
        scale = _cross_modal_scale(source)
        load_by_date[activity_date] = load_by_date.get(activity_date, 0.0) + float(load_value) * scale

    # Fill gaps between first and last date with 0 (rest days)
    start_date = min(load_by_date.keys())
    end_date = max(load_by_date.keys())

    daily_loads = []
    current = start_date
    while current <= end_date:
        day_index = (current - start_date).days
        daily_loads.append((day_index, load_by_date.get(current, 0.0)))
        current += timedelta(days=1)

    return daily_loads, str(start_date)


def fit_from_db(conn, estimated_hrmax: float = 190) -> BanisterParams:
    """End-to-end Banister fitting from database.

    1. Load anchor runs from DB
    2. Load daily training loads from DB
    3. Fit Banister parameters
    4. Store results in banister_params table

    Args:
        conn: psycopg2 database connection.
        estimated_hrmax: Estimated maximum heart rate.

    Returns:
        Fitted BanisterParams.
    """
    # Table 'banister_params' is defined in sync/schema.sql

    # Load data
    anchors = load_anchors_from_db(conn, estimated_hrmax=estimated_hrmax)
    daily_loads, min_date = _load_daily_loads_from_db(conn)

    # Convert anchor dates to day indices relative to the load series
    if min_date and anchors:
        from datetime import date as date_type

        min_d = date_type.fromisoformat(min_date)
        anchor_inputs = []
        for a in anchors:
            anchor_date = date_type.fromisoformat(str(a["date"])[:10])
            day_index = (anchor_date - min_d).days
            anchor_inputs.append({"day_index": day_index, "vdot": a["vdot"]})
    else:
        anchor_inputs = []

    # Fit
    params = fit_banister(daily_loads, anchor_inputs)

    # Store
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO banister_params (p0, k1, k2, tau1, tau2, n_anchors, fitted_at)
            VALUES (%s, %s, %s, %s, %s, %s, NOW())
        """, (params.p0, params.k1, params.k2, params.tau1, params.tau2, len(anchor_inputs)))
    conn.commit()

    return params
