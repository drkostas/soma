"""
Readiness Stream — Computes daily readiness from biometric z-scores.

Research refs:
- Dawes 1979: Equal weights outperform regression in small samples
- Nuuttila 2021: HRV+HR 92% PPV for overtraining detection
- Plews 2013: rolling 7-day CV(lnRMSSD) as HRV stability metric

Signals:
  1. HRV z-score (vs 28-day rolling baseline)
  2. Sleep z-score (total sleep time vs 28-day baseline)
  3. RHR z-score (inverted — higher RHR = lower readiness)
  4. Body Battery z-score (morning value vs 28-day baseline)

Hard overrides:
  - Sleep < 5h → RED
  - Body battery morning < 25 → RED
  - 2/4 signals flagged (z < -1) → YELLOW
  - 3/4 signals flagged → RED

Traffic light output:
  GREEN  → full training
  YELLOW → reduce intensity, swap hard for easy
  RED    → rest or very easy only
"""

import json
import math
from datetime import date, timedelta


def z_score(value: float, baseline: list[float]) -> float:
    """Compute z-score of value against baseline values.
    Returns 0.0 if baseline has insufficient data (< 7 values) or zero std.
    """
    if len(baseline) < 7:
        return 0.0

    n = len(baseline)
    mean = sum(baseline) / n
    variance = sum((x - mean) ** 2 for x in baseline) / n
    std = math.sqrt(variance)

    if std == 0.0:
        return 0.0

    return (value - mean) / std


def compute_readiness(signals: dict) -> dict:
    """
    Compute readiness from signal z-scores.

    Args:
        signals: {
            "hrv_z": float,
            "sleep_z": float,
            "rhr_z": float,       # NOTE: RHR is inverted (high RHR = negative z)
            "bb_z": float,        # body battery
            "sleep_hours": float, # raw sleep hours for hard override
            "body_battery_morning": float,  # raw BB value for hard override (optional)
        }

    Returns: {
        "hrv_z_score": float,
        "sleep_z_score": float,
        "rhr_z_score": float,
        "body_battery_z_score": float,
        "composite_score": float,  # equal-weight mean of z-scores
        "traffic_light": "green"|"yellow"|"red",
        "flags": list[str],       # which overrides/rules triggered
    }
    """
    hrv_z = signals["hrv_z"]
    sleep_z = signals["sleep_z"]
    rhr_z = signals["rhr_z"]
    bb_z = signals["bb_z"]
    sleep_hours = signals["sleep_hours"]
    body_battery_morning = signals.get("body_battery_morning")

    # Equal-weight composite — only average non-None z-scores (Dawes 1979)
    z_values = [z for z in [hrv_z, sleep_z, rhr_z, bb_z] if z is not None]
    composite = sum(z_values) / len(z_values) if z_values else 0.0

    flags = []
    traffic_light = "green"

    # --- Hard overrides ---
    if sleep_hours < 5.0:
        flags.append("sleep_under_5h")
        traffic_light = "red"

    if body_battery_morning is not None and body_battery_morning < 25:
        flags.append("body_battery_critical")
        traffic_light = "red"

    # HRV SWC override: z < -0.5 = dropped more than 1 SWC (only if HRV available)
    if hrv_z is not None and hrv_z < -0.5:
        flags.append("hrv_below_swc")

    # --- Majority rule (only count non-None signals) ---
    z_scores = [z for z in [hrv_z, sleep_z, rhr_z, bb_z] if z is not None]
    flagged_count = sum(1 for z in z_scores if z < -1.0)

    if flagged_count >= 3:
        flags.append("3_of_4_flagged")
        traffic_light = "red"
    elif flagged_count >= 2 and traffic_light != "red":
        flags.append("2_of_4_flagged")
        traffic_light = "yellow"

    return {
        "hrv_z_score": hrv_z,
        "sleep_z_score": sleep_z,
        "rhr_z_score": rhr_z,
        "body_battery_z_score": bb_z,
        "composite_score": round(composite, 4),
        "traffic_light": traffic_light,
        "flags": flags,
    }


def compute_daily_readiness(conn, target_date: date) -> dict:
    """
    Compute readiness for a specific date using data from the database.

    1. Query daily_health_summary for last 35 days (28 baseline + 7 buffer)
    2. Extract HRV, sleep time, RHR, body battery for each day
    3. Compute z-scores for the target date against 28-day baseline
    4. Run compute_readiness()
    5. Store result in daily_readiness table

    Returns the readiness dict.
    """
    start_date = target_date - timedelta(days=34)

    with conn.cursor() as cur:
        cur.execute("""
            SELECT date, avg_overnight_hrv, sleep_time_seconds,
                   resting_heart_rate, body_battery_at_wake
            FROM daily_health_summary
            WHERE date BETWEEN %s AND %s
            ORDER BY date
        """, (start_date, target_date))
        rows = cur.fetchall()

    if not rows:
        return {
            "hrv_z_score": 0.0,
            "sleep_z_score": 0.0,
            "rhr_z_score": 0.0,
            "body_battery_z_score": 0.0,
            "composite_score": 0.0,
            "traffic_light": "green",
            "flags": ["no_data"],
        }

    # Separate target day from baseline days
    target_row = None
    baseline_rows = []
    for row in rows:
        row_date, hrv, sleep_sec, rhr, bb = row
        if row_date == target_date:
            target_row = row
        else:
            baseline_rows.append(row)

    if target_row is None:
        return {
            "hrv_z_score": 0.0,
            "sleep_z_score": 0.0,
            "rhr_z_score": 0.0,
            "body_battery_z_score": 0.0,
            "composite_score": 0.0,
            "traffic_light": "green",
            "flags": ["no_target_data"],
        }

    _, today_hrv, today_sleep_sec, today_rhr, today_bb = target_row

    # Build baseline arrays (skip None values)
    hrv_baseline = [r[1] for r in baseline_rows if r[1] is not None]
    sleep_baseline = [r[2] for r in baseline_rows if r[2] is not None]
    rhr_baseline = [r[3] for r in baseline_rows if r[3] is not None]
    bb_baseline = [r[4] for r in baseline_rows if r[4] is not None]

    # Compute z-scores (None for missing today values instead of 0.0)
    hrv_z = z_score(float(today_hrv), [float(x) for x in hrv_baseline]) if today_hrv is not None else None
    sleep_z = z_score(float(today_sleep_sec), [float(x) for x in sleep_baseline]) if today_sleep_sec is not None else None
    # RHR is inverted: higher RHR = lower readiness → negate the z-score
    rhr_z_raw = z_score(float(today_rhr), [float(x) for x in rhr_baseline]) if today_rhr is not None else None
    rhr_z = -rhr_z_raw if rhr_z_raw is not None else None
    bb_z = z_score(float(today_bb), [float(x) for x in bb_baseline]) if today_bb is not None else None

    # Convert sleep seconds to hours for hard override
    sleep_hours = (today_sleep_sec / 3600.0) if today_sleep_sec is not None else 8.0

    signals = {
        "hrv_z": hrv_z,
        "sleep_z": sleep_z,
        "rhr_z": rhr_z,
        "bb_z": bb_z,
        "sleep_hours": sleep_hours,
        "body_battery_morning": today_bb,
    }

    result = compute_readiness(signals)

    # Store in daily_readiness table
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO daily_readiness
                (date, hrv_z_score, sleep_z_score, rhr_z_score,
                 body_battery_z_score, composite_score, traffic_light,
                 flags, weight_method, computed_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'equal', NOW())
            ON CONFLICT (date)
            DO UPDATE SET
                hrv_z_score = EXCLUDED.hrv_z_score,
                sleep_z_score = EXCLUDED.sleep_z_score,
                rhr_z_score = EXCLUDED.rhr_z_score,
                body_battery_z_score = EXCLUDED.body_battery_z_score,
                composite_score = EXCLUDED.composite_score,
                traffic_light = EXCLUDED.traffic_light,
                flags = EXCLUDED.flags,
                weight_method = EXCLUDED.weight_method,
                computed_at = NOW()
        """, (
            target_date,
            result["hrv_z_score"],
            result["sleep_z_score"],
            result["rhr_z_score"],
            result["body_battery_z_score"],
            result["composite_score"],
            result["traffic_light"],
            json.dumps(result["flags"]),
        ))

    conn.commit()
    return result
