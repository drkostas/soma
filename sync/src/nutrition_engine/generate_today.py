"""Generate today's nutrition plan — Task 18.

CLI script: python -m nutrition_engine.generate_today

Pulls context from DB (profile, weight, training plan, sleep) and calls
generate_daily_plan to produce macro targets, then upserts into nutrition_day.
"""

from __future__ import annotations

import json
import logging
from datetime import date

from db import get_connection
from nutrition_engine.daily_plan import classify_sleep_quality, generate_daily_plan
from nutrition_engine.tdee import bootstrap_tdee

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

DEFAULT_TDEE = 2300
DEFAULT_WEIGHT_KG = 80.0
DEFAULT_DEFICIT = 300
DEFAULT_SLEEP_SCORE = 80.0


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _classify_training_day(cur, today: date) -> str:
    """Determine training day type from today's training_plan_day row."""
    cur.execute(
        """
        SELECT d.run_type, d.gym_workout
        FROM training_plan_day d
        JOIN training_plan p ON d.plan_id = p.id
        WHERE p.status = 'active' AND d.day_date = %s
        LIMIT 1
        """,
        (today,),
    )
    row = cur.fetchone()
    if row is None:
        return "rest"

    run_type, gym_workout = row[0], row[1]
    has_run = run_type is not None and run_type.strip() != ""
    has_gym = gym_workout is not None and gym_workout.strip() != ""

    if has_run and has_gym:
        return "gym_and_run"

    if has_run:
        rt = run_type.lower()
        if "long" in rt:
            return "long_run"
        if any(k in rt for k in ("interval", "tempo", "vo2")):
            return "hard_run"
        return "easy_run"

    if has_gym:
        return "gym"

    return "rest"


def _get_sleep_score(cur, today: date) -> float:
    """Get composite sleep quality score from last night's sleep_detail."""
    cur.execute(
        """
        SELECT total_sleep_seconds, deep_sleep_seconds, sleep_score
        FROM sleep_detail
        WHERE date = %s
        """,
        (today,),
    )
    row = cur.fetchone()
    if row is None:
        return DEFAULT_SLEEP_SCORE

    total_sec = row[0] or 0
    deep_sec = row[1] or 0
    garmin_score = row[2] or 0
    return classify_sleep_quality(total_sec, deep_sec, garmin_score)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def generate_today() -> None:
    """Generate and store today's nutrition plan."""
    today = date.today()

    with get_connection() as conn:
        cur = conn.cursor()

        # 1. Get nutrition_profile (singleton, id=1)
        cur.execute("SELECT target_calories, weight_kg, goal, daily_deficit FROM nutrition_profile WHERE id = 1")
        profile = cur.fetchone()
        if profile is None:
            logger.error("No nutrition_profile found (id=1). Run seed/setup first.")
            cur.close()
            return

        profile_calories, profile_weight, profile_goal, profile_deficit = (
            profile[0], profile[1], profile[2], profile[3]
        )

        # 2. TDEE — use profile target_calories as a base, else bootstrap from Garmin
        tdee = None
        if profile_calories:
            tdee = float(profile_calories)

        if tdee is None:
            cur.execute(
                """
                SELECT bmr_kilocalories, active_kilocalories
                FROM daily_health_summary
                WHERE bmr_kilocalories IS NOT NULL
                ORDER BY date DESC LIMIT 1
                """
            )
            health_row = cur.fetchone()
            if health_row and health_row[0]:
                bmr = float(health_row[0])
                active = float(health_row[1] or 0)
                tdee = bootstrap_tdee(bmr, active)
                logger.info("TDEE bootstrapped from Garmin: %.0f (BMR=%.0f, active=%.0f)", tdee, bmr, active)
            else:
                tdee = DEFAULT_TDEE
                logger.info("No Garmin data; using default TDEE=%d", DEFAULT_TDEE)

        # 3. Weight from weight_log (latest)
        cur.execute(
            "SELECT weight_grams FROM weight_log WHERE weight_grams IS NOT NULL ORDER BY date DESC LIMIT 1"
        )
        weight_row = cur.fetchone()
        weight_kg = (float(weight_row[0]) / 1000.0) if weight_row else DEFAULT_WEIGHT_KG
        if not weight_row:
            logger.info("No weight data; using default %.1f kg", DEFAULT_WEIGHT_KG)

        # 4. Training day type
        training_day = _classify_training_day(cur, today)
        logger.info("Training day type: %s", training_day)

        # 5. Sleep quality score
        sleep_score = _get_sleep_score(cur, today)
        logger.info("Sleep quality score: %.1f", sleep_score)

        # 6. Generate daily plan
        deficit = float(profile_deficit) if profile_deficit else DEFAULT_DEFICIT
        plan = generate_daily_plan(
            tdee=tdee,
            deficit=deficit,
            weight_kg=weight_kg,
            training_day_type=training_day,
            sleep_quality_score=sleep_score,
        )

        # 7. Upsert into nutrition_day
        plan_json = json.dumps(plan)
        cur.execute(
            """
            INSERT INTO nutrition_day (date, plan, target_calories, target_protein, target_carbs, target_fat)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (date) DO UPDATE SET
                plan            = EXCLUDED.plan,
                target_calories = EXCLUDED.target_calories,
                target_protein  = EXCLUDED.target_protein,
                target_carbs    = EXCLUDED.target_carbs,
                target_fat      = EXCLUDED.target_fat
            """,
            (
                today,
                plan_json,
                plan["target_calories"],
                plan["target_protein"],
                plan["target_carbs"],
                plan["target_fat"],
            ),
        )
        cur.close()

        # 8. Print summary
        logger.info(
            "Nutrition plan for %s: %d kcal | P %dg C %dg F %dg | type=%s deficit=%.0f sleep=%.0f",
            today,
            plan["target_calories"],
            plan["target_protein"],
            plan["target_carbs"],
            plan["target_fat"],
            training_day,
            plan["deficit_used"],
            sleep_score,
        )


if __name__ == "__main__":
    generate_today()
