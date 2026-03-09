"""
Load Stream — Computes per-activity training load and PMC (CTL/ATL/TSB).

Formulas:
  EWMA: value_today = load * alpha + value_yesterday * (1 - alpha)
  alpha = 1 - exp(-1/tau)
  CTL tau = 42 days, ATL tau = 7 days
  TSB = CTL - ATL
"""

import json
import math
from datetime import date, timedelta


def compute_activity_load(activity_raw: dict, source: str) -> dict:
    """Extract or compute load from a single activity.

    Primary: EPOC from Garmin (activityTrainingLoad field).
    Fallback: estimated 50.0 for activities without EPOC.

    Returns dict with: load_metric, load_value, source, duration_seconds
    """
    epoc = activity_raw.get("activityTrainingLoad")
    if epoc is not None and epoc > 0:
        return {
            "load_metric": "epoc",
            "load_value": float(epoc),
            "source": source,
            "duration_seconds": activity_raw.get("duration"),
        }
    # Duration-based estimate: ~1.5 EPOC per minute for moderate activity
    # Median EPOC for a 60-min run is ~90, so 1.5/min is reasonable
    duration_sec = activity_raw.get("duration") or 0
    duration_min = max(duration_sec / 60.0, 0)
    estimated = round(duration_min * 1.5, 1) if duration_min > 0 else 50.0

    return {
        "load_metric": "estimated",
        "load_value": estimated,
        "source": source,
        "duration_seconds": activity_raw.get("duration"),
    }


def compute_trimp(
    duration_min: float,
    avg_hr: float | None,
    resting_hr: float,
    max_hr: float,
) -> float | None:
    """Compute Banister TRIMP from average HR data.

    Formula: TRIMP = duration(min) x delta_HR_ratio x 0.64 x e^(1.92 x delta_HR_ratio)
    where delta_HR_ratio = (HR_exercise - HR_rest) / (HR_max - HR_rest)

    Returns None if HR data is missing.
    """
    if avg_hr is None:
        return None
    if max_hr <= resting_hr or duration_min <= 0:
        return 0.0

    delta_hr_ratio = (avg_hr - resting_hr) / (max_hr - resting_hr)
    delta_hr_ratio = max(0.0, min(1.0, delta_hr_ratio))

    return duration_min * delta_hr_ratio * 0.64 * math.exp(1.92 * delta_hr_ratio)


def compute_pmc(
    daily_loads: list[tuple[date, float]],
    tau_ctl: float = 42,
    tau_atl: float = 7,
) -> list[dict]:
    """
    Compute PMC from chronological daily loads.

    Args:
        daily_loads: List of (date, total_load_for_day) sorted ascending.
        tau_ctl: CTL time constant (42 days).
        tau_atl: ATL time constant (7 days).

    Returns:
        List of {date, ctl, atl, tsb, daily_load} dicts.
    """
    if not daily_loads:
        return []

    alpha_ctl = 1 - math.exp(-1 / tau_ctl)
    alpha_atl = 1 - math.exp(-1 / tau_atl)

    results = []
    ctl = 0.0
    atl = 0.0

    for dt, load in daily_loads:
        ctl = load * alpha_ctl + ctl * (1 - alpha_ctl)
        atl = load * alpha_atl + atl * (1 - alpha_atl)
        tsb = ctl - atl
        results.append({
            "date": dt,
            "ctl": round(ctl, 2),
            "atl": round(atl, 2),
            "tsb": round(tsb, 2),
            "daily_load": load,
        })

    return results


def backfill_load_from_history(conn) -> list[dict]:
    """
    Extract per-activity EPOC from garmin_activity_raw for all historical activities.
    Store results in training_load table.
    Returns list of inserted load records.

    Query garmin_activity_raw WHERE endpoint_name = 'summary'
    Extract activityTrainingLoad, activityId, startTimeLocal, duration, activityType.
    Skip activities already in training_load.
    """
    with conn.cursor() as cur:
        # Fetch all summary activities from raw store
        cur.execute("""
            SELECT activity_id, raw_json
            FROM garmin_activity_raw
            WHERE endpoint_name = 'summary'
        """)
        rows = cur.fetchall()

    inserted = []
    for activity_id, raw_json in rows:
        if isinstance(raw_json, str):
            raw_json = json.loads(raw_json)

        activity_date_str = raw_json.get("startTimeLocal")
        if not activity_date_str:
            continue

        # Parse date from startTimeLocal (e.g. "2026-01-15 08:30:00")
        activity_date = date.fromisoformat(activity_date_str[:10])
        activity_type = (raw_json.get("activityType") or {}).get("typeKey", "unknown")
        source = f"garmin_{activity_type}"

        load = compute_activity_load(raw_json, source=source)

        # Compute TRIMP as secondary cross-check metric
        avg_hr = raw_json.get("averageHR")
        resting_hr = raw_json.get("minHR") or 50
        max_hr_val = raw_json.get("maxHR") or 190
        trimp = compute_trimp(
            duration_min=max((raw_json.get("duration") or 0) / 60, 0),
            avg_hr=avg_hr,
            resting_hr=resting_hr,
            max_hr=max_hr_val,
        )

        with conn.cursor() as cur:
            # Upsert: skip if activity already exists for this metric
            cur.execute("""
                INSERT INTO training_load
                    (activity_date, activity_id, source, load_metric, load_value,
                     duration_seconds, details)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT DO NOTHING
            """, (
                activity_date,
                activity_id,
                load["source"],
                load["load_metric"],
                load["load_value"],
                load["duration_seconds"],
                json.dumps({
                    "activity_type": activity_type,
                    "original_epoc": raw_json.get("activityTrainingLoad"),
                    "trimp": round(trimp, 1) if trimp is not None else None,
                }),
            ))

            if cur.rowcount > 0:
                inserted.append({
                    "activity_id": activity_id,
                    "activity_date": activity_date,
                    **load,
                })

    conn.commit()
    return inserted


def _cross_modal_scale(source: str) -> float:
    """Scale factor for non-running activities entering the running PMC.

    Running = 1.0, strength = 0.5 (already pre-scaled for hevy),
    cycling = 0.6, walking = 0.2, others = 0.3.
    """
    s = source.lower()
    if "running" in s or "treadmill" in s:
        return 1.0
    if s == "hevy":
        return 1.0  # already cross-modal scaled (0.5x) before insertion
    if "cycling" in s or "bike" in s:
        return 0.6
    if "walking" in s:
        return 0.2
    if "swimming" in s or "lap_swimming" in s:
        return 0.5
    return 0.3


def compute_and_store_pmc(conn, tau_ctl: float = 42, tau_atl: float = 7) -> list[dict]:
    """
    1. Query training_load table, group by date, sum loads per day
       with cross-modal scaling for non-running activities
    2. Fill date gaps with 0 (rest days)
    3. Compute PMC via compute_pmc()
    4. Upsert results into pmc_daily table
    Returns list of PMC entries.
    """
    with conn.cursor() as cur:
        cur.execute("""
            SELECT activity_date, source, load_value
            FROM training_load
            ORDER BY activity_date
        """)
        rows = cur.fetchall()

    if not rows:
        return []

    # Build a dict of date -> total scaled load
    load_by_date: dict[date, float] = {}
    for activity_date, source, load_value in rows:
        scale = _cross_modal_scale(source)
        load_by_date[activity_date] = load_by_date.get(activity_date, 0.0) + float(load_value) * scale

    # Fill gaps between first and last date
    start_date = min(load_by_date.keys())
    end_date = max(load_by_date.keys())

    daily_loads = []
    current = start_date
    while current <= end_date:
        daily_loads.append((current, load_by_date.get(current, 0.0)))
        current += timedelta(days=1)

    # Compute PMC
    pmc_results = compute_pmc(daily_loads, tau_ctl=tau_ctl, tau_atl=tau_atl)

    # Upsert into pmc_daily
    with conn.cursor() as cur:
        for entry in pmc_results:
            cur.execute("""
                INSERT INTO pmc_daily (date, ctl, atl, tsb, daily_load, computed_at)
                VALUES (%s, %s, %s, %s, %s, NOW())
                ON CONFLICT (date)
                DO UPDATE SET
                    ctl = EXCLUDED.ctl,
                    atl = EXCLUDED.atl,
                    tsb = EXCLUDED.tsb,
                    daily_load = EXCLUDED.daily_load,
                    computed_at = NOW()
            """, (
                entry["date"],
                entry["ctl"],
                entry["atl"],
                entry["tsb"],
                entry["daily_load"],
            ))

    conn.commit()
    return pmc_results
