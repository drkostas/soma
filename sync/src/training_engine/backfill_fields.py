#!/usr/bin/env python3
"""
Fast backfill of high-value fields in daily_health_summary directly from raw JSONB.
Uses a single connection and SQL-based extraction — much faster than re-parsing.

Usage: cd sync && PYTHONPATH=src python3 -m training_engine.backfill_fields
"""
import json
import logging
from db import get_connection

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def backfill():
    with get_connection() as conn:
        with conn.cursor() as cur:
            # 1. Backfill body_battery_at_wake from user_summary
            logger.info("Backfilling body_battery_at_wake...")
            cur.execute("""
                UPDATE daily_health_summary dhs
                SET body_battery_at_wake = (raw.raw_json->>'bodyBatteryAtWakeTime')::int
                FROM garmin_raw_data raw
                WHERE raw.date = dhs.date
                  AND raw.endpoint_name = 'user_summary'
                  AND raw.raw_json->>'bodyBatteryAtWakeTime' IS NOT NULL
                  AND dhs.body_battery_at_wake IS NULL
            """)
            logger.info("  body_battery_at_wake: %d rows updated", cur.rowcount)

            # 2. Backfill rhr_7day_avg from user_summary
            logger.info("Backfilling rhr_7day_avg...")
            cur.execute("""
                UPDATE daily_health_summary dhs
                SET rhr_7day_avg = (raw.raw_json->>'lastSevenDaysAvgRestingHeartRate')::float
                FROM garmin_raw_data raw
                WHERE raw.date = dhs.date
                  AND raw.endpoint_name = 'user_summary'
                  AND raw.raw_json->>'lastSevenDaysAvgRestingHeartRate' IS NOT NULL
                  AND dhs.rhr_7day_avg IS NULL
            """)
            logger.info("  rhr_7day_avg: %d rows updated", cur.rowcount)

            # 3. Backfill avg_overnight_hrv from hrv_data (hrvSummary.lastNightAvg)
            logger.info("Backfilling avg_overnight_hrv...")
            cur.execute("""
                UPDATE daily_health_summary dhs
                SET avg_overnight_hrv = (raw.raw_json->'hrvSummary'->>'lastNightAvg')::float
                FROM garmin_raw_data raw
                WHERE raw.date = dhs.date
                  AND raw.endpoint_name = 'hrv_data'
                  AND raw.raw_json->'hrvSummary'->>'lastNightAvg' IS NOT NULL
                  AND dhs.avg_overnight_hrv IS NULL
            """)
            logger.info("  avg_overnight_hrv: %d rows updated", cur.rowcount)

            # 4. Backfill hrv_baseline from hrv_data (hrvSummary.baseline.balancedLow)
            logger.info("Backfilling hrv_baseline...")
            cur.execute("""
                UPDATE daily_health_summary dhs
                SET hrv_baseline = (raw.raw_json->'hrvSummary'->'baseline'->>'balancedLow')::float
                FROM garmin_raw_data raw
                WHERE raw.date = dhs.date
                  AND raw.endpoint_name = 'hrv_data'
                  AND raw.raw_json->'hrvSummary'->'baseline'->>'balancedLow' IS NOT NULL
                  AND dhs.hrv_baseline IS NULL
            """)
            logger.info("  hrv_baseline: %d rows updated", cur.rowcount)

            # 5. Backfill avg_sleep_stress from sleep_data
            logger.info("Backfilling avg_sleep_stress...")
            cur.execute("""
                UPDATE daily_health_summary dhs
                SET avg_sleep_stress = (raw.raw_json->'dailySleepDTO'->>'avgSleepStress')::float
                FROM garmin_raw_data raw
                WHERE raw.date = dhs.date
                  AND raw.endpoint_name = 'sleep_data'
                  AND raw.raw_json->'dailySleepDTO'->>'avgSleepStress' IS NOT NULL
                  AND dhs.avg_sleep_stress IS NULL
            """)
            logger.info("  avg_sleep_stress: %d rows updated", cur.rowcount)

            # 6. Backfill training_readiness_score from training_readiness
            # Note: training_readiness raw is a LIST, need to extract first valid entry
            logger.info("Backfilling training_readiness...")
            cur.execute("""
                SELECT date, raw_json FROM garmin_raw_data
                WHERE endpoint_name = 'training_readiness'
            """)
            tr_rows = cur.fetchall()
            tr_count = 0
            for tr_date, raw_json in tr_rows:
                if isinstance(raw_json, str):
                    raw_json = json.loads(raw_json)
                if not isinstance(raw_json, list):
                    continue
                # Prefer entry with validSleep=True
                best = None
                for entry in raw_json:
                    if isinstance(entry, dict) and entry.get("score") is not None:
                        if entry.get("validSleep"):
                            best = entry
                            break
                        if best is None:
                            best = entry
                if best:
                    score = best.get("score")
                    level = best.get("level", "")
                    cur.execute("""
                        UPDATE daily_health_summary
                        SET training_readiness_score = %s,
                            training_readiness_level = %s
                        WHERE date = %s
                          AND training_readiness_score IS NULL
                    """, (score, level, tr_date))
                    tr_count += cur.rowcount

            logger.info("  training_readiness: %d rows updated", tr_count)

            # Final stats
            cur.execute("""
                SELECT count(*) as total,
                       count(avg_overnight_hrv) as hrv,
                       count(body_battery_at_wake) as bb,
                       count(rhr_7day_avg) as rhr,
                       count(avg_sleep_stress) as stress,
                       count(training_readiness_score) as tr
                FROM daily_health_summary
            """)
            stats = cur.fetchone()
            logger.info("\nFinal stats: total=%d, hrv=%d, bb=%d, rhr=%d, stress=%d, readiness=%d",
                        *stats)


if __name__ == "__main__":
    backfill()
