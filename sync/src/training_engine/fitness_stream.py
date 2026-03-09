"""
Fitness Stream — VO2max trend, pace-HR decoupling, efficiency factor.

Research:
- Efficiency Factor (EF) = speed / HR = (1/pace_sec_km) / avg_HR
- Decoupling = (EF_first_half - EF_second_half) / EF_first_half * 100
- Decoupling < 5% = aerobically coupled (good aerobic base)
- VO2max: extracted from Garmin (max_metrics endpoint)
"""

import json
from datetime import date, timedelta

from training_engine.vdot import time_from_vdot

# Standard half-marathon distance in meters
HM_DISTANCE_M = 21097.5


def compute_efficiency_factor(pace_sec_per_km: float, avg_hr: float) -> float:
    """EF = speed / HR. Higher = more efficient.

    pace_sec_per_km: pace in seconds per km (e.g. 330 = 5:30/km)
    avg_hr: average heart rate in bpm

    Returns: EF value (typically 1.0-2.0 range when multiplied by 1000)
    """
    if pace_sec_per_km <= 0 or avg_hr <= 0:
        return 0.0
    speed = 1.0 / pace_sec_per_km  # km/sec
    return speed / avg_hr


def compute_decoupling(first_half: dict, second_half: dict) -> float:
    """Compute pace:HR decoupling between first and second half of a run.

    Each half: {"pace_sec_km": float, "avg_hr": float}

    Returns: decoupling percentage (positive = cardiac drift, negative = negative split)
    """
    ef1 = compute_efficiency_factor(first_half["pace_sec_km"], first_half["avg_hr"])
    ef2 = compute_efficiency_factor(second_half["pace_sec_km"], second_half["avg_hr"])
    if ef1 == 0:
        return 0.0
    return (ef1 - ef2) / ef1 * 100


def extract_vo2max(max_metrics_raw) -> float | None:
    """Extract VO2max from Garmin max_metrics endpoint data.

    The raw data can be a list of metric entries or a single dict.
    Checks common field paths: generic.vo2MaxPreciseValue and top-level vo2MaxPreciseValue.

    Returns VO2max float or None if not found.
    """
    if isinstance(max_metrics_raw, list):
        for item in max_metrics_raw:
            if not isinstance(item, dict):
                continue
            generic = item.get("generic")
            if isinstance(generic, dict):
                vo2 = generic.get("vo2MaxPreciseValue")
                if vo2 is not None:
                    return float(vo2)
            vo2 = item.get("vo2MaxPreciseValue")
            if vo2 is not None:
                return float(vo2)
    elif isinstance(max_metrics_raw, dict):
        generic = max_metrics_raw.get("generic")
        if isinstance(generic, dict):
            vo2 = generic.get("vo2MaxPreciseValue")
            if vo2 is not None:
                return float(vo2)
        vo2 = max_metrics_raw.get("vo2MaxPreciseValue")
        if vo2 is not None:
            return float(vo2)
    return None


def update_fitness_trajectory(conn, target_date: date = None) -> dict | None:
    """
    Update fitness_trajectory table for the target date.

    1. Extract latest VO2max from garmin_raw_data max_metrics
    2. Query recent qualifying runs (>30min, E-pace zone) for decoupling
    3. Compute EF from most recent qualifying run
    4. Get current weight from daily_health_summary
    5. Upsert into fitness_trajectory

    Returns the fitness dict or None if insufficient data.
    """
    if target_date is None:
        target_date = date.today()

    vo2max = None
    ef = None
    decoupling_pct = None
    weight_kg = None

    with conn.cursor() as cur:
        # 1. Extract latest VO2max from garmin_raw_data
        cur.execute("""
            SELECT raw_json
            FROM garmin_raw_data
            WHERE endpoint_name = 'max_metrics'
              AND date <= %s
            ORDER BY date DESC
            LIMIT 1
        """, (target_date,))
        row = cur.fetchone()
        if row:
            raw = row[0]
            if isinstance(raw, str):
                raw = json.loads(raw)
            vo2max = extract_vo2max(raw)

        # 2. Query recent qualifying runs for decoupling
        # Look at garmin_activity_raw for running activities with splits
        cur.execute("""
            SELECT raw_json
            FROM garmin_activity_raw
            WHERE endpoint_name = 'splits'
              AND activity_id IN (
                  SELECT activity_id
                  FROM garmin_activity_raw
                  WHERE endpoint_name = 'summary'
                    AND (raw_json->>'duration')::float > 2400
                    AND raw_json->'activityType'->>'typeKey' = 'running'
                    AND (raw_json->>'startTimeLocal')::date <= %s
                  ORDER BY (raw_json->>'startTimeLocal')::date DESC
                  LIMIT 1
              )
        """, (target_date,))
        splits_row = cur.fetchone()

        if splits_row:
            splits_raw = splits_row[0]
            if isinstance(splits_raw, str):
                splits_raw = json.loads(splits_raw)
            halves = _split_into_halves(splits_raw)
            if halves:
                first_half, second_half = halves
                ef = compute_efficiency_factor(
                    first_half["pace_sec_km"], first_half["avg_hr"]
                )
                decoupling_pct = compute_decoupling(first_half, second_half)

        # If no splits data, try to compute EF from the summary directly
        if ef is None:
            cur.execute("""
                SELECT raw_json
                FROM garmin_activity_raw
                WHERE endpoint_name = 'summary'
                  AND (raw_json->>'duration')::float > 2400
                  AND raw_json->'activityType'->>'typeKey' = 'running'
                  AND (raw_json->>'startTimeLocal')::date <= %s
                ORDER BY (raw_json->>'startTimeLocal')::date DESC
                LIMIT 1
            """, (target_date,))
            summary_row = cur.fetchone()
            if summary_row:
                summary = summary_row[0]
                if isinstance(summary, str):
                    summary = json.loads(summary)
                distance_m = summary.get("distance")
                duration_s = summary.get("duration")
                avg_hr = summary.get("averageHR")
                if distance_m and duration_s and avg_hr and distance_m > 0:
                    pace_sec_km = duration_s / (distance_m / 1000.0)
                    ef = compute_efficiency_factor(pace_sec_km, avg_hr)

        # 4. Get current weight from weight_log (body_comp_stream handles EMA)
        cur.execute("""
            SELECT weight_grams / 1000.0
            FROM weight_log
            WHERE date <= %s AND weight_grams IS NOT NULL AND weight_grams > 0
            ORDER BY date DESC
            LIMIT 1
        """, (target_date,))
        weight_row = cur.fetchone()
        if weight_row:
            weight_kg = float(weight_row[0])

    # Only upsert if we have at least one metric
    if vo2max is None and ef is None and decoupling_pct is None:
        return None

    # Compute race prediction from VO2max (half-marathon time in seconds)
    race_prediction_seconds = None
    if vo2max is not None and vo2max > 0:
        race_prediction_seconds = round(time_from_vdot(vo2max, HM_DISTANCE_M))

    result = {
        "date": target_date,
        "vo2max": vo2max,
        "efficiency_factor": round(ef, 10) if ef is not None else None,
        "decoupling_pct": round(decoupling_pct, 2) if decoupling_pct is not None else None,
        "weight_kg": round(weight_kg, 1) if weight_kg is not None else None,
        "race_prediction_seconds": race_prediction_seconds,
    }

    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO fitness_trajectory
                (date, vo2max, efficiency_factor, decoupling_pct, weight_kg,
                 race_prediction_seconds, computed_at)
            VALUES (%s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT (date)
            DO UPDATE SET
                vo2max = EXCLUDED.vo2max,
                efficiency_factor = EXCLUDED.efficiency_factor,
                decoupling_pct = EXCLUDED.decoupling_pct,
                weight_kg = EXCLUDED.weight_kg,
                race_prediction_seconds = EXCLUDED.race_prediction_seconds,
                computed_at = NOW()
        """, (
            target_date,
            result["vo2max"],
            result["efficiency_factor"],
            result["decoupling_pct"],
            result["weight_kg"],
            result["race_prediction_seconds"],
        ))

    conn.commit()
    return result


def _split_into_halves(splits_raw) -> tuple[dict, dict] | None:
    """Split activity split data into first/second half with pace and HR.

    Garmin splits typically have lapMetrics or splitSummaries with
    distance, duration, and averageHR per lap/split.

    Returns tuple of (first_half, second_half) dicts with pace_sec_km and avg_hr,
    or None if data is insufficient.
    """
    laps = []

    # Handle different Garmin splits formats
    if isinstance(splits_raw, dict):
        laps = splits_raw.get("lapDTOs", []) or splits_raw.get("splitSummaries", [])
    elif isinstance(splits_raw, list):
        laps = splits_raw

    if len(laps) < 2:
        return None

    mid = len(laps) // 2
    first_laps = laps[:mid]
    second_laps = laps[mid:]

    first_half = _aggregate_laps(first_laps)
    second_half = _aggregate_laps(second_laps)

    if first_half is None or second_half is None:
        return None

    return first_half, second_half


def _aggregate_laps(laps: list[dict]) -> dict | None:
    """Aggregate a list of lap dicts into a single pace_sec_km and avg_hr.

    Returns {"pace_sec_km": float, "avg_hr": float} or None if insufficient data.
    """
    total_distance_m = 0.0
    total_duration_s = 0.0
    hr_weighted_sum = 0.0

    for lap in laps:
        distance = lap.get("distance", 0) or 0
        duration = lap.get("duration", 0) or lap.get("elapsedDuration", 0) or 0
        avg_hr = lap.get("averageHR", 0) or lap.get("averageHeartRate", 0) or 0

        if distance > 0 and duration > 0 and avg_hr > 0:
            total_distance_m += distance
            total_duration_s += duration
            hr_weighted_sum += avg_hr * duration

    if total_distance_m <= 0 or total_duration_s <= 0 or hr_weighted_sum <= 0:
        return None

    pace_sec_km = total_duration_s / (total_distance_m / 1000.0)
    avg_hr = hr_weighted_sum / total_duration_s

    return {"pace_sec_km": pace_sec_km, "avg_hr": avg_hr}
