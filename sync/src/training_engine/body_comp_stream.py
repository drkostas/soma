"""
Body Comp Stream — Weight smoothing and VDOT adjustment.

Research:
- 7-day EMA for weight smoothing (removes daily noise from water/food)
- VDOT weight adjustment: VDOT_adj = VDOT_base * (weight_calibration / weight_current)
  Lighter = higher VDOT (faster potential)
"""

from datetime import date, timedelta

from config import today_nyc
from training_engine.vdot import adjust_vdot_for_weight, time_from_vdot

# Standard half-marathon distance in meters
HM_DISTANCE_M = 21097.5


def compute_weight_ema(weights: list[tuple[date, float]], span: int = 7) -> list[dict]:
    """
    Compute exponential moving average of weights.

    Args:
        weights: List of (date, weight_kg) sorted ascending.
        span: EMA span in days (default 7).

    Returns:
        List of {"date": date, "weight_raw": float, "weight_ema": float}
    """
    alpha = 2.0 / (span + 1)
    results = []
    ema = None
    for dt, w in weights:
        if ema is None:
            ema = w
        else:
            ema = w * alpha + ema * (1 - alpha)
        results.append({"date": dt, "weight_raw": w, "weight_ema": round(ema, 2)})
    return results


## adjust_vdot_for_weight is imported from training_engine.vdot
## Kept as re-export for backward compatibility with existing callers.


# Default calibration weight: athlete's weight at VDOT 47 calibration (5K PR March 7, 2026)
DEFAULT_CALIBRATION_WEIGHT_KG = 80.5


def update_body_comp(conn, target_date: date = None,
                     calibration_weight_kg: float = DEFAULT_CALIBRATION_WEIGHT_KG) -> dict | None:
    """
    Fetch weight data from weight_log, compute 7-day EMA, adjust VDOT.

    1. Query weight_log for the last 30 days of weight entries (in kg).
    2. Compute 7-day EMA via compute_weight_ema().
    3. Fetch latest VO2max from fitness_trajectory as VDOT base.
    4. Use the first EMA value as calibration weight, current EMA as current.
    5. Upsert weight_kg and vdot_adjusted into fitness_trajectory.

    Returns dict with smoothed weight and adjusted VDOT, or None if no data.
    """
    if target_date is None:
        target_date = today_nyc()

    start_date = target_date - timedelta(days=29)

    with conn.cursor() as cur:
        # 1. Fetch recent weight entries (weight_log stores weight_grams)
        cur.execute(
            """
            SELECT date, weight_grams / 1000.0 AS weight_kg
            FROM weight_log
            WHERE date BETWEEN %s AND %s
              AND weight_grams IS NOT NULL
              AND weight_grams > 0
            ORDER BY date
        """,
            (start_date, target_date),
        )
        rows = cur.fetchall()

    if not rows:
        return None

    weights = [(row[0], float(row[1])) for row in rows]
    ema_results = compute_weight_ema(weights, span=7)

    if not ema_results:
        return None

    current_ema = ema_results[-1]["weight_ema"]

    # Use fixed calibration weight from VDOT measurement
    calibration_weight = calibration_weight_kg

    # 3. Fetch latest VO2max from fitness_trajectory
    vdot_base = None
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT vo2max
            FROM fitness_trajectory
            WHERE date <= %s AND vo2max IS NOT NULL
            ORDER BY date DESC
            LIMIT 1
        """,
            (target_date,),
        )
        row = cur.fetchone()
        if row:
            vdot_base = float(row[0])

    # 4. Compute adjusted VDOT
    vdot_adjusted = None
    if vdot_base is not None:
        vdot_adjusted = adjust_vdot_for_weight(
            vdot_base, calibration_weight, current_ema
        )
        vdot_adjusted = round(vdot_adjusted, 2)

    # 4b. Compute race prediction from weight-adjusted VDOT
    race_prediction_seconds = None
    effective_vdot = vdot_adjusted or vdot_base
    if effective_vdot is not None and effective_vdot > 0:
        race_prediction_seconds = round(time_from_vdot(effective_vdot, HM_DISTANCE_M))

    result = {
        "date": target_date,
        "weight_kg": round(current_ema, 2),
        "weight_raw": ema_results[-1]["weight_raw"],
        "vdot_base": vdot_base,
        "vdot_adjusted": vdot_adjusted,
        "race_prediction_seconds": race_prediction_seconds,
        "calibration_weight_kg": calibration_weight,
        "ema_points": len(ema_results),
    }

    # 5. Upsert into fitness_trajectory
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO fitness_trajectory
                (date, weight_kg, vdot_adjusted, race_prediction_seconds, computed_at)
            VALUES (%s, %s, %s, %s, NOW())
            ON CONFLICT (date)
            DO UPDATE SET
                weight_kg = EXCLUDED.weight_kg,
                vdot_adjusted = COALESCE(EXCLUDED.vdot_adjusted, fitness_trajectory.vdot_adjusted),
                race_prediction_seconds = COALESCE(EXCLUDED.race_prediction_seconds, fitness_trajectory.race_prediction_seconds),
                computed_at = NOW()
        """,
            (target_date, result["weight_kg"], result["vdot_adjusted"], result["race_prediction_seconds"]),
        )

    conn.commit()
    return result
