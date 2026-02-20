"""Parse raw Garmin JSON into structured database rows (Layer 1 -> Layer 2)."""

from datetime import date
from db import get_connection


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
        "sleep_start": dto.get("sleepStartTimestampLocal"),
        "sleep_end": dto.get("sleepEndTimestampLocal"),
    }


def parse_hrv(raw_data: dict) -> dict:
    """Extract HRV fields from hrv_data raw JSON."""
    return {
        "hrv_weekly_avg": raw_data.get("weeklyAvg"),
        "hrv_last_night_avg": raw_data.get("lastNightAvg"),
        "hrv_status": raw_data.get("status"),
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

            upsert_daily_health(conn, parsed)

        # Parse weigh_ins -> weight_log
        if "weigh_ins" in raw_by_endpoint:
            entries = parse_weight_entries(raw_by_endpoint["weigh_ins"])
            for entry in entries:
                if entry["weight_grams"]:
                    upsert_weight(conn, entry)

        # Parse sleep_data -> sleep_detail
        if "sleep_data" in raw_by_endpoint:
            sleep = parse_sleep(raw_by_endpoint["sleep_data"])
            if sleep:
                upsert_sleep(conn, sync_date, sleep)
