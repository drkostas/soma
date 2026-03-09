"""Parse raw Garmin JSON into structured database rows (Layer 1 -> Layer 2)."""

from datetime import date, datetime, timezone
from db import get_connection


def _ms_to_datetime(ms):
    """Convert millisecond Unix timestamp to datetime, or return None."""
    if ms is None:
        return None
    if isinstance(ms, (int, float)):
        return datetime.fromtimestamp(ms / 1000, tz=timezone.utc)
    return ms


def parse_daily_health(sync_date: date, raw_data: dict) -> dict:
    """Extract structured fields from user_summary raw JSON."""
    return {
        "date": sync_date,
        "total_steps": raw_data.get("totalSteps"),
        "total_distance_meters": raw_data.get("totalDistanceMeters"),
        "floors_climbed": raw_data.get("floorsClimbed"),
        "active_time_seconds": raw_data.get("activeTimeInSeconds"),
        "sedentary_time_seconds": raw_data.get("sedentaryTimeInSeconds"),
        "moderate_intensity_minutes": raw_data.get("moderateIntensityMinutes"),
        "vigorous_intensity_minutes": raw_data.get("vigorousIntensityMinutes"),
        "total_kilocalories": raw_data.get("totalKilocalories"),
        "active_kilocalories": raw_data.get("activeKilocalories"),
        "bmr_kilocalories": raw_data.get("bmrKilocalories"),
        "resting_heart_rate": raw_data.get("restingHeartRate"),
        "min_heart_rate": raw_data.get("minHeartRate"),
        "max_heart_rate": raw_data.get("maxHeartRate"),
        "avg_stress_level": raw_data.get("averageStressLevel"),
        "max_stress_level": raw_data.get("maxStressLevel"),
        "body_battery_charged": raw_data.get("bodyBatteryChargedValue"),
        "body_battery_drained": raw_data.get("bodyBatteryDrainedValue"),
        "sleep_time_seconds": raw_data.get("sleepingTimeInSeconds"),
        "body_battery_at_wake": raw_data.get("bodyBatteryAtWakeTime"),
        "rhr_7day_avg": raw_data.get("lastSevenDaysAvgRestingHeartRate"),
    }


def parse_weight_entries(raw_data: dict) -> list[dict]:
    """Extract weight entries from weigh_ins raw JSON."""
    entries = []
    for item in raw_data.get("dateWeightList", []):
        entries.append({
            "date": item.get("calendarDate"),
            "weight_grams": item.get("weight"),
            "bmi": item.get("bmi"),
            "body_fat_pct": item.get("bodyFat"),
            "body_water_pct": item.get("bodyWater"),
            "bone_mass_grams": item.get("boneMass"),
            "muscle_mass_grams": item.get("muscleMass"),
            "source_type": item.get("sourceType"),
        })
    return entries


def parse_sleep(raw_data: dict) -> dict | None:
    """Extract sleep fields from sleep_data raw JSON."""
    dto = raw_data.get("dailySleepDTO")
    if not dto:
        return None

    scores = dto.get("sleepScores", {})
    overall_score = scores.get("overall", {}).get("value")

    return {
        "total_sleep_seconds": dto.get("sleepTimeSeconds"),
        "deep_sleep_seconds": dto.get("deepSleepSeconds"),
        "light_sleep_seconds": dto.get("lightSleepSeconds"),
        "rem_sleep_seconds": dto.get("remSleepSeconds"),
        "awake_seconds": dto.get("awakeSleepSeconds"),
        "sleep_score": overall_score,
        "sleep_start": _ms_to_datetime(dto.get("sleepStartTimestampLocal")),
        "sleep_end": _ms_to_datetime(dto.get("sleepEndTimestampLocal")),
        "avg_sleep_stress": dto.get("avgSleepStress"),
    }


def parse_hrv(raw_data: dict) -> dict:
    """Extract HRV fields from hrv_data raw JSON."""
    # HRV data is nested under hrvSummary
    summary = raw_data.get("hrvSummary", raw_data)
    baseline = summary.get("baseline") or {}
    return {
        "hrv_weekly_avg": summary.get("weeklyAvg"),
        "hrv_last_night_avg": summary.get("lastNightAvg"),
        "hrv_status": summary.get("status"),
        "avg_overnight_hrv": summary.get("lastNightAvg"),
        "hrv_baseline": baseline.get("balancedLow"),
    }


def parse_training_readiness(raw_data) -> dict:
    """Extract training readiness from training_readiness raw JSON.

    The raw data is a list of readiness snapshots. We prefer the latest
    entry where ``validSleep`` is ``True`` (post-sleep calculation).
    Falls back to the first entry if none have valid sleep.
    """
    if not raw_data or not isinstance(raw_data, list):
        return {"training_readiness_score": None, "training_readiness_level": None}

    # Prefer validSleep=True entries, take the last one (most recent)
    best = None
    for entry in raw_data:
        if entry.get("validSleep"):
            best = entry
    if best is None and raw_data:
        best = raw_data[0]

    return {
        "training_readiness_score": best.get("score") if best else None,
        "training_readiness_level": best.get("level") if best else None,
    }


def upsert_daily_health(conn, parsed: dict):
    """Upsert a row into daily_health_summary."""
    columns = list(parsed.keys())
    placeholders = [f"%({col})s" for col in columns]
    updates = [f"{col} = EXCLUDED.{col}" for col in columns if col != "date"]
    updates.append("updated_at = NOW()")

    sql = f"""
        INSERT INTO daily_health_summary ({', '.join(columns)})
        VALUES ({', '.join(placeholders)})
        ON CONFLICT (date)
        DO UPDATE SET {', '.join(updates)}
    """
    with conn.cursor() as cur:
        cur.execute(sql, parsed)


def upsert_weight(conn, entry: dict):
    """Upsert a weight_log entry."""
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO weight_log (date, weight_grams, bmi, body_fat_pct, body_water_pct,
                                     bone_mass_grams, muscle_mass_grams, source_type)
            VALUES (%(date)s, %(weight_grams)s, %(bmi)s, %(body_fat_pct)s, %(body_water_pct)s,
                    %(bone_mass_grams)s, %(muscle_mass_grams)s, %(source_type)s)
            ON CONFLICT (date, weight_grams) DO NOTHING
            """,
            entry,
        )


def upsert_sleep(conn, sync_date: date, parsed: dict):
    """Upsert a sleep_detail row."""
    parsed["date"] = sync_date
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO sleep_detail (date, sleep_start, sleep_end, total_sleep_seconds,
                                       deep_sleep_seconds, light_sleep_seconds, rem_sleep_seconds,
                                       awake_seconds, sleep_score)
            VALUES (%(date)s, %(sleep_start)s, %(sleep_end)s, %(total_sleep_seconds)s,
                    %(deep_sleep_seconds)s, %(light_sleep_seconds)s, %(rem_sleep_seconds)s,
                    %(awake_seconds)s, %(sleep_score)s)
            ON CONFLICT (date)
            DO UPDATE SET sleep_start = EXCLUDED.sleep_start,
                          sleep_end = EXCLUDED.sleep_end,
                          total_sleep_seconds = EXCLUDED.total_sleep_seconds,
                          deep_sleep_seconds = EXCLUDED.deep_sleep_seconds,
                          light_sleep_seconds = EXCLUDED.light_sleep_seconds,
                          rem_sleep_seconds = EXCLUDED.rem_sleep_seconds,
                          awake_seconds = EXCLUDED.awake_seconds,
                          sleep_score = EXCLUDED.sleep_score,
                          synced_at = NOW()
            """,
            parsed,
        )


def process_day(sync_date: date):
    """Read raw data for a date and populate structured tables."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT endpoint_name, raw_json FROM garmin_raw_data WHERE date = %s",
                (sync_date,),
            )
            rows = cur.fetchall()

        raw_by_endpoint = {name: data for name, data in rows}

        # Parse user_summary -> daily_health_summary
        if "user_summary" in raw_by_endpoint:
            parsed = parse_daily_health(sync_date, raw_by_endpoint["user_summary"])

            # Merge HRV data if available
            if "hrv_data" in raw_by_endpoint and raw_by_endpoint["hrv_data"]:
                hrv = parse_hrv(raw_by_endpoint["hrv_data"])
                parsed.update(hrv)

            # Merge sleep duration from sleep_data if user_summary lacks it
            if "sleep_data" in raw_by_endpoint:
                sleep = parse_sleep(raw_by_endpoint["sleep_data"])
                if sleep:
                    if not parsed.get("sleep_time_seconds") and sleep.get("total_sleep_seconds"):
                        parsed["sleep_time_seconds"] = sleep["total_sleep_seconds"]
                    if sleep.get("avg_sleep_stress") is not None:
                        parsed["avg_sleep_stress"] = sleep["avg_sleep_stress"]

            # Merge training readiness if available
            if "training_readiness" in raw_by_endpoint:
                tr = parse_training_readiness(raw_by_endpoint["training_readiness"])
                parsed.update(tr)

            upsert_daily_health(conn, parsed)

        # Parse weigh_ins / daily_weigh_ins -> weight_log
        for ep in ("daily_weigh_ins", "weigh_ins"):
            if ep in raw_by_endpoint:
                entries = parse_weight_entries(raw_by_endpoint[ep])
                for entry in entries:
                    if entry["weight_grams"]:
                        upsert_weight(conn, entry)

        # Parse sleep_data -> sleep_detail
        if "sleep_data" in raw_by_endpoint:
            sleep = parse_sleep(raw_by_endpoint["sleep_data"])
            if sleep:
                upsert_sleep(conn, sync_date, sleep)


def reparse_all():
    """Re-parse ALL dates from raw data to backfill structured tables.

    Iterates over every distinct date in garmin_raw_data and runs
    process_day() for each. This is useful after adding new parsed
    columns — it populates them from existing raw JSONB without
    needing to re-fetch from the Garmin API.
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT DISTINCT date FROM garmin_raw_data ORDER BY date"
            )
            all_dates = [row[0] for row in cur.fetchall()]

    total = len(all_dates)
    if total == 0:
        print("No raw data found.")
        return

    print(f"Re-parsing {total} dates...")
    success = 0
    errors = 0
    for i, sync_date in enumerate(all_dates):
        try:
            process_day(sync_date)
            success += 1
        except Exception as e:
            errors += 1
            print(f"  Error on {sync_date}: {e}")
        if (i + 1) % 100 == 0 or (i + 1) == total:
            print(f"  [{i+1}/{total}] {success} ok, {errors} errors")

    print(f"\nReparse complete: {success}/{total} days updated, {errors} errors.")


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "reparse":
        reparse_all()
    else:
        print("Usage: python -m parsers reparse")
        print("  Re-parse all dates from raw data to backfill structured columns.")
