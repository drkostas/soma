"""Auto-close yesterday's nutrition day with actual activity data.

Called at the start of generate_today before creating today's plan.
Replaces predicted values with actuals:
- Run calories -> actual from garmin_activity_raw
- Gym calories -> actual from workout_enrichment
- Unfinished predicted activities -> 0
- Steps -> actual from daily_health_summary
"""

import logging
import json
from datetime import date, datetime, timedelta, timezone

from config import today_nyc

logger = logging.getLogger(__name__)


def close_yesterday(conn) -> None:
    """Close all unclosed past nutrition days with reconciled actuals."""
    today = today_nyc()

    with conn.cursor() as cur:
        # Find ALL unclosed past days (not just yesterday)
        cur.execute(
            "SELECT date, selected_workouts, run_enabled, plan "
            "FROM nutrition_day WHERE date < %s AND status = 'active' "
            "ORDER BY date",
            (today,),
        )
        unclosed_days = cur.fetchall()
        if not unclosed_days:
            return

    for yesterday, selected_workouts, run_enabled, plan_json in unclosed_days:
      with conn.cursor() as cur:
        selected = selected_workouts or []

        # 1. Actual steps
        cur.execute(
            "SELECT total_steps FROM daily_health_summary WHERE date = %s",
            (yesterday,),
        )
        steps_row = cur.fetchone()
        actual_steps = int(steps_row[0]) if steps_row and steps_row[0] else 0

        # 2. Actual run calories from Garmin
        actual_run_cal = 0
        if run_enabled:
            cur.execute(
                """
                SELECT COALESCE(SUM((raw_json->>'calories')::float), 0)
                FROM garmin_activity_raw
                WHERE endpoint_name = 'summary'
                  AND raw_json->'activityType'->>'typeKey' = 'running'
                  AND (raw_json->>'startTimeLocal')::date = %s
                """,
                (yesterday,),
            )
            r = cur.fetchone()
            actual_run_cal = round(float(r[0])) if r and r[0] else 0

        # 3. Actual gym calories from workout_enrichment
        actual_gym_cal = 0
        gym_details = {}
        cur.execute(
            "SELECT hevy_title, calories FROM workout_enrichment WHERE workout_date = %s",
            (yesterday,),
        )
        for r in cur.fetchall():
            if r[0]:
                gym_details[r[0]] = round(float(r[1])) if r[1] else 0
                actual_gym_cal += gym_details[r[0]]

        # 4. Sum meal + drink actuals
        cur.execute(
            """SELECT COALESCE(SUM(calories),0), COALESCE(SUM(protein),0),
                      COALESCE(SUM(carbs),0), COALESCE(SUM(fat),0),
                      COALESCE(SUM(fiber),0)
               FROM meal_log WHERE date = %s""",
            (yesterday,),
        )
        m = cur.fetchone()
        cur.execute(
            "SELECT COALESCE(SUM(calories),0), COALESCE(SUM(carbs),0) FROM drink_log WHERE date = %s",
            (yesterday,),
        )
        d = cur.fetchone()

        actual = {
            "calories": round(float(m[0]) + float(d[0])),
            "protein": round(float(m[1])),
            "carbs": round(float(m[2]) + float(d[1])),
            "fat": round(float(m[3])),
            "fiber": round(float(m[4])),
        }

        # 5. Build reconciled data
        existing_plan = plan_json if isinstance(plan_json, dict) else (
            json.loads(plan_json) if plan_json else {}
        )
        reconciled = {
            "actual_steps": actual_steps,
            "actual_run_calories": actual_run_cal,
            "actual_gym_calories": actual_gym_cal,
            "actual_gym_details": gym_details,
            "unmatched_workouts": [w for w in selected if w not in gym_details],
            "reconciled_at": today.isoformat(),
        }
        existing_plan["reconciled"] = reconciled

        # 6. Update and close
        cur.execute(
            """
            UPDATE nutrition_day SET
                actual_calories = %s, actual_protein = %s,
                actual_carbs = %s, actual_fat = %s, actual_fiber = %s,
                plan = %s, status = 'closed'
            WHERE date = %s
            """,
            (
                actual["calories"], actual["protein"],
                actual["carbs"], actual["fat"], actual["fiber"],
                json.dumps(existing_plan), yesterday,
            ),
        )

        logger.info(
            "Auto-closed %s: intake=%d cal, steps=%d, run=%d cal, gym=%d cal, unmatched=%s",
            yesterday, actual["calories"], actual_steps, actual_run_cal, actual_gym_cal,
            reconciled["unmatched_workouts"],
        )
