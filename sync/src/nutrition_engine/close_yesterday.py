"""Auto-close yesterday's nutrition day with actual activity data.

Called at the start of generate_today before creating today's plan.
Replaces predicted values with actuals:
- Run calories -> actual from garmin_activity_raw
- Gym calories -> actual from workout_enrichment
- Unfinished predicted activities -> 0
- Steps -> actual from daily_health_summary
- target_calories -> recomputed from actual burn so un-done predicted
  workouts/runs don't inflate historical deficit math
"""

import logging
import json
from datetime import date, datetime, timedelta, timezone

from config import today_nyc

logger = logging.getLogger(__name__)

# Same step-kcal formula as the TS plan API (route.ts:247)
KCAL_PER_STEP_PER_KG = 0.000423


def compute_actual_target(
    bmr: float,
    actual_steps: int,
    weight_kg: float,
    actual_run_cal: int,
    actual_gym_cal: int,
    deficit_used: int,
) -> tuple[int, int]:
    """Recompute target_calories and tdee_used from actuals at close time.

    Strips any predicted run/gym kcal that was baked into the in-day target
    when those activities were never completed.

    Returns (target_calories, tdee_used).
    """
    actual_step_cal = round(actual_steps * KCAL_PER_STEP_PER_KG * weight_kg)
    actual_total_burn = round(bmr + actual_step_cal + actual_run_cal + actual_gym_cal)
    new_target = round(actual_total_burn - deficit_used)
    return new_target, actual_total_burn


def close_yesterday(conn) -> None:
    """Close all unclosed past nutrition days with reconciled actuals."""
    today = today_nyc()

    with conn.cursor() as cur:
        # Find ALL unclosed past days (not just yesterday)
        cur.execute(
            "SELECT date, selected_workouts, run_enabled, plan, "
            "       deficit_used, target_calories, target_protein, target_fat "
            "FROM nutrition_day WHERE date < %s AND status = 'active' "
            "ORDER BY date",
            (today,),
        )
        unclosed_days = cur.fetchall()
        if not unclosed_days:
            return

    for (yesterday, selected_workouts, run_enabled, plan_json,
         old_deficit, old_target, old_protein, old_fat) in unclosed_days:
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

        # 5. Recompute target_calories from actuals.
        #
        # The in-day plan API write-back may have included PREDICTED run/gym
        # calories — kcal of activities the user selected but never actually
        # did. If we leave target_calories alone, the 7-day trend table
        # silently over-credits historical burn (since it derives burn as
        # target + deficit_used).
        #
        # Strip predictions: target = actual_total_burn - deficit_used.
        # Protein/fat targets are weight-based so unaffected. Carbs =
        # leftover kcal, recompute to keep macro sum consistent.
        cur.execute(
            "SELECT bmr_kilocalories FROM daily_health_summary "
            "WHERE date <= %s AND bmr_kilocalories > 1500 "
            "ORDER BY date DESC LIMIT 1",
            (yesterday,),
        )
        bmr_row = cur.fetchone()
        bmr = round(float(bmr_row[0])) if bmr_row and bmr_row[0] else 0

        cur.execute("SELECT weight_kg FROM nutrition_profile WHERE id = 1")
        prof_row = cur.fetchone()
        weight_kg = float(prof_row[0]) if prof_row and prof_row[0] else 74.0

        deficit_used = int(old_deficit) if old_deficit is not None else 800

        new_target, new_tdee = compute_actual_target(
            bmr=bmr,
            actual_steps=actual_steps,
            weight_kg=weight_kg,
            actual_run_cal=actual_run_cal,
            actual_gym_cal=actual_gym_cal,
            deficit_used=deficit_used,
        )

        protein_g = int(old_protein) if old_protein is not None else 0
        fat_g = int(old_fat) if old_fat is not None else 0
        new_carbs = max(0, round((new_target - protein_g * 4 - fat_g * 9) / 4))

        # 6. Build reconciled data
        existing_plan = plan_json if isinstance(plan_json, dict) else (
            json.loads(plan_json) if plan_json else {}
        )
        reconciled = {
            "actual_steps": actual_steps,
            "actual_run_calories": actual_run_cal,
            "actual_gym_calories": actual_gym_cal,
            "actual_gym_details": gym_details,
            "unmatched_workouts": [w for w in selected if w not in gym_details],
            "actual_total_burn": new_tdee,
            "old_target_calories": int(old_target) if old_target is not None else None,
            "new_target_calories": new_target,
            "reconciled_at": today.isoformat(),
        }
        existing_plan["reconciled"] = reconciled

        # 7. Update and close
        cur.execute(
            """
            UPDATE nutrition_day SET
                actual_calories = %s, actual_protein = %s,
                actual_carbs = %s, actual_fat = %s, actual_fiber = %s,
                target_calories = %s, target_carbs = %s, tdee_used = %s,
                plan = %s, status = 'closed'
            WHERE date = %s
            """,
            (
                actual["calories"], actual["protein"],
                actual["carbs"], actual["fat"], actual["fiber"],
                new_target, new_carbs, new_tdee,
                json.dumps(existing_plan), yesterday,
            ),
        )

        target_delta = new_target - (int(old_target) if old_target else new_target)
        logger.info(
            "Auto-closed %s: intake=%d cal, steps=%d, run=%d cal, gym=%d cal, "
            "target %d → %d (Δ%+d), unmatched=%s",
            yesterday, actual["calories"], actual_steps, actual_run_cal, actual_gym_cal,
            int(old_target) if old_target else 0, new_target, target_delta,
            reconciled["unmatched_workouts"],
        )
