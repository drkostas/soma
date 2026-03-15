"""Generate today's nutrition plan — full dynamic pipeline.

CLI script: python -m nutrition_engine.generate_today

Pulls context from DB (profile, weight, training plan, sleep) and computes
TDEE from BMR + step calories + exercise calories. Derives deficit from
body-composition goal (if set) or falls back to profile deficit. Adjusts
for sleep quality (single-night + multi-day escalation). Produces macro
targets with carb periodization, then upserts into nutrition_day.
"""

from __future__ import annotations

import json
import logging
from datetime import date, timedelta

from db import get_connection
from nutrition_engine.daily_plan import (
    adjust_deficit_for_sleep,
    adjust_for_sleep_history,
    classify_sleep_quality,
)
from nutrition_engine.tdee import (
    bootstrap_tdee_base,
    compute_deficit_from_goal,
    compute_exercise_calories,
    compute_macro_targets,
    compute_step_calories,
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

DEFAULT_TDEE = 2300
DEFAULT_WEIGHT_KG = 80.0
DEFAULT_DEFICIT = 300
DEFAULT_SLEEP_SCORE = 80.0
DEFAULT_AGE = 30
DEFAULT_SEX = "male"
DEFAULT_STEP_GOAL = 10000


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _classify_training_day_from_row(run_type: str | None, gym_workout: str | None) -> str:
    """Determine training day type from training_plan_day column values."""
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


def _get_sleep_score(cur, today: date) -> tuple[float, float | None]:
    """Get composite sleep quality score and total hours from last night."""
    cur.execute(
        "SELECT total_sleep_seconds, deep_sleep_seconds, sleep_score "
        "FROM sleep_detail WHERE date = %s",
        (today,),
    )
    row = cur.fetchone()
    if row is None:
        return DEFAULT_SLEEP_SCORE, None

    total_sec = row[0] or 0
    deep_sec = row[1] or 0
    garmin_score = row[2] or 0
    score = classify_sleep_quality(total_sec, deep_sec, garmin_score)
    hours = total_sec / 3600.0
    return score, hours


def _count_consecutive_poor_nights(cur, today: date, threshold: float = 50.0) -> int:
    """Count consecutive nights with sleep score below threshold, up to 7 days back.

    Missing data (no sleep_detail row) breaks the streak — we assume those
    nights were okay rather than counting them as poor.
    """
    count = 0
    for days_back in range(1, 8):
        d = today - timedelta(days=days_back)
        cur.execute(
            "SELECT total_sleep_seconds, deep_sleep_seconds, sleep_score "
            "FROM sleep_detail WHERE date = %s",
            (d,),
        )
        row = cur.fetchone()
        if row is None:
            break  # No data = assume okay
        total_sec = row[0] or 0
        deep_sec = row[1] or 0
        garmin_score = row[2] or 0
        score = classify_sleep_quality(total_sec, deep_sec, garmin_score)
        if score >= threshold:
            break
        count += 1
    return count


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def generate_today() -> None:
    """Generate and store today's nutrition plan."""
    today = date.today()

    with get_connection() as conn:
        cur = conn.cursor()

        # 1. Read full nutrition_profile (singleton, id=1)
        cur.execute(
            "SELECT target_calories, weight_kg, goal, daily_deficit,"
            " estimated_ffm_kg, protein_g_per_kg, fat_g_per_kg,"
            " estimated_bf_pct, target_bf_pct, target_date, age, sex, step_goal"
            " FROM nutrition_profile WHERE id = 1"
        )
        profile = cur.fetchone()
        if profile is None:
            logger.error("No nutrition_profile found (id=1). Run seed/setup first.")
            cur.close()
            return

        (
            profile_calories, profile_weight, profile_goal, profile_deficit,
            profile_ffm_kg, profile_protein_g_per_kg, profile_fat_g_per_kg,
            profile_bf_pct, profile_target_bf_pct, profile_target_date,
            profile_age, profile_sex, profile_step_goal,
        ) = profile

        age = int(profile_age) if profile_age else DEFAULT_AGE
        sex = profile_sex if profile_sex else DEFAULT_SEX
        step_goal = int(profile_step_goal) if profile_step_goal else DEFAULT_STEP_GOAL
        protein_g_per_kg = float(profile_protein_g_per_kg) if profile_protein_g_per_kg else 2.2
        fat_g_per_kg = float(profile_fat_g_per_kg) if profile_fat_g_per_kg else 0.8
        ffm_kg = float(profile_ffm_kg) if profile_ffm_kg else None
        estimated_bf_pct = float(profile_bf_pct) if profile_bf_pct else None

        # 2. Latest weight from weight_log
        cur.execute(
            "SELECT weight_grams FROM weight_log "
            "WHERE weight_grams IS NOT NULL ORDER BY date DESC LIMIT 1"
        )
        weight_row = cur.fetchone()
        weight_kg = (float(weight_row[0]) / 1000.0) if weight_row else DEFAULT_WEIGHT_KG
        if not weight_row:
            logger.info("No weight data; using default %.1f kg", DEFAULT_WEIGHT_KG)

        # 3. Bootstrap base TDEE = BMR from Garmin
        bmr = None
        cur.execute(
            "SELECT bmr_kilocalories FROM daily_health_summary "
            "WHERE bmr_kilocalories IS NOT NULL "
            "ORDER BY date DESC LIMIT 1"
        )
        health_row = cur.fetchone()
        if health_row and health_row[0]:
            bmr = float(health_row[0])
        elif profile_calories:
            bmr = float(profile_calories)
            logger.info("No Garmin BMR; using profile target_calories=%d as base", bmr)
        else:
            bmr = DEFAULT_TDEE
            logger.info("No Garmin data or profile calories; using default TDEE=%d", DEFAULT_TDEE)

        base_tdee = bootstrap_tdee_base(bmr)

        # 4. Step calories from step_goal
        step_cal = compute_step_calories(step_goal, weight_kg)
        logger.info("Step calories: %.0f (goal=%d, weight=%.1fkg)", step_cal, step_goal, weight_kg)

        # 5. Fetch today's training_plan_day → extract workout info
        cur.execute(
            """
            SELECT d.run_type, d.gym_workout, d.workout_steps, d.target_distance_km
            FROM training_plan_day d
            JOIN training_plan p ON d.plan_id = p.id
            WHERE p.status = 'active' AND d.day_date = %s
            LIMIT 1
            """,
            (today,),
        )
        plan_day_row = cur.fetchone()

        if plan_day_row is not None:
            run_type, gym_workout, workout_steps_raw, target_distance_km = plan_day_row
            # Parse workout_steps JSONB
            if isinstance(workout_steps_raw, str):
                workout_steps = json.loads(workout_steps_raw) if workout_steps_raw else None
            else:
                workout_steps = workout_steps_raw  # already a list/dict from psycopg2
        else:
            run_type, gym_workout, workout_steps, target_distance_km = None, None, None, None

        training_day = _classify_training_day_from_row(run_type, gym_workout)
        has_gym = gym_workout is not None and str(gym_workout).strip() != ""
        logger.info("Training day type: %s", training_day)

        # 6. Compute exercise calories from workout_steps + optional gym
        exercise_cal = compute_exercise_calories(
            workout_steps=workout_steps if isinstance(workout_steps, list) else None,
            weight_kg=weight_kg,
            age=age,
            sex=sex,
            has_gym=has_gym,
            run_distance_km=float(target_distance_km) if target_distance_km else 0,
        )
        logger.info("Exercise calories: %.0f", exercise_cal)

        # 7. TDEE = BMR + step_calories + exercise_calories
        #    (compute_macro_targets expects base TDEE and exercise_calories separately)
        tdee = base_tdee + step_cal
        total_exercise_cal = step_cal + exercise_cal
        logger.info("TDEE breakdown: BMR=%.0f + steps=%.0f + exercise=%.0f = %.0f",
                     base_tdee, step_cal, exercise_cal, base_tdee + step_cal + exercise_cal)

        # 8. Compute deficit: goal-based (if target_bf_pct + target_date) or profile
        deficit_info = None
        if (profile_target_bf_pct is not None and profile_target_date is not None
                and estimated_bf_pct is not None):
            deficit_info = compute_deficit_from_goal(
                weight_kg=weight_kg,
                current_bf_pct=estimated_bf_pct,
                target_bf_pct=float(profile_target_bf_pct),
                target_date=profile_target_date,
                today=today,
            )
            deficit = deficit_info["daily_deficit"]
            logger.info(
                "Goal-based deficit: %d kcal/day (%.1fkg fat to lose in %.1f weeks, safety=%s)",
                deficit, deficit_info["fat_to_lose_kg"],
                deficit_info["timeline_weeks"], deficit_info["safety"],
            )
        else:
            deficit = float(profile_deficit) if profile_deficit else DEFAULT_DEFICIT
            logger.info("Using profile deficit: %.0f", deficit)

        # 9. Sleep quality + adjustment
        sleep_score, sleep_hours = _get_sleep_score(cur, today)
        logger.info("Sleep quality score: %.1f, hours: %s",
                     sleep_score, f"{sleep_hours:.1f}" if sleep_hours is not None else "N/A")

        # Single-night sleep adjustment
        sleep_result = adjust_deficit_for_sleep(deficit, sleep_score, sleep_hours)

        # Multi-day escalation
        consecutive_poor = _count_consecutive_poor_nights(cur, today)
        if consecutive_poor > 0:
            logger.info("Consecutive poor sleep nights: %d", consecutive_poor)
        sleep_result = adjust_for_sleep_history(consecutive_poor, sleep_result)

        adjusted_deficit = sleep_result["deficit"]
        adjustment_reason = sleep_result["reason"]
        protein_boost = sleep_result["protein_boost_g"]
        fiber_boost = sleep_result["fiber_boost_g"]

        if adjustment_reason != "normal":
            logger.info("Sleep adjustment: %s (deficit %.0f → %.0f)",
                        adjustment_reason, deficit, adjusted_deficit)

        # 10. Compute macro targets with carb periodization
        macros = compute_macro_targets(
            tdee=tdee,
            deficit=adjusted_deficit,
            weight_kg=weight_kg,
            exercise_calories=exercise_cal,
            training_day_type=training_day,
            protein_g_per_kg=protein_g_per_kg,
            fat_g_per_kg=fat_g_per_kg,
            estimated_bf_pct=estimated_bf_pct,
            ffm_kg=ffm_kg,
        )

        # Apply sleep boosts — recompute carbs to maintain calorie target
        target_protein = macros["protein"] + protein_boost
        target_fiber = macros["fiber"] + fiber_boost
        if protein_boost > 0:
            # Extra protein calories displace carb calories
            target_carbs = max(0, round((macros["calories"] - target_protein * 4 - macros["fat"] * 9) / 4))
        else:
            target_carbs = macros["carbs"]

        # Build the plan dict (stored as JSONB for backward compatibility)
        plan = {
            "target_calories": macros["calories"],
            "target_protein": target_protein,
            "target_carbs": target_carbs,
            "target_fat": macros["fat"],
            "target_fiber": target_fiber,
            "tdee_used": round(base_tdee + step_cal + exercise_cal),
            "deficit_used": adjusted_deficit,
            "adjustment_reason": adjustment_reason,
            "sleep_quality_score": sleep_score,
            "training_day_type": training_day,
            "is_refeed": False,
            "protein_boost_g": protein_boost,
            "fiber_boost_g": fiber_boost,
            "exercise_calories": round(exercise_cal),
            "step_calories": round(step_cal),
            "step_goal": step_goal,
        }
        if deficit_info:
            plan["deficit_info"] = deficit_info

        # Build planned_workouts JSONB summary
        planned_workouts = None
        if plan_day_row is not None:
            pw = {}
            if run_type and run_type.strip():
                pw["run_type"] = run_type
            if gym_workout and str(gym_workout).strip():
                pw["gym_workout"] = gym_workout
            if workout_steps:
                pw["workout_steps"] = workout_steps
            if pw:
                planned_workouts = json.dumps(pw)

        # 11. Upsert into nutrition_day
        plan_json = json.dumps(plan)
        cur.execute(
            """
            INSERT INTO nutrition_day (
                date, plan, target_calories, target_protein, target_carbs, target_fat,
                target_fiber, tdee_used, deficit_used, adjustment_reason,
                sleep_quality_score, training_day_type, is_refeed,
                exercise_calories, step_calories, planned_workouts, step_goal
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (date) DO UPDATE SET
                plan                = EXCLUDED.plan,
                target_calories     = EXCLUDED.target_calories,
                target_protein      = EXCLUDED.target_protein,
                target_carbs        = EXCLUDED.target_carbs,
                target_fat          = EXCLUDED.target_fat,
                target_fiber        = EXCLUDED.target_fiber,
                tdee_used           = EXCLUDED.tdee_used,
                deficit_used        = EXCLUDED.deficit_used,
                adjustment_reason   = EXCLUDED.adjustment_reason,
                sleep_quality_score = EXCLUDED.sleep_quality_score,
                training_day_type   = EXCLUDED.training_day_type,
                is_refeed           = EXCLUDED.is_refeed,
                exercise_calories   = EXCLUDED.exercise_calories,
                step_calories       = EXCLUDED.step_calories,
                planned_workouts    = EXCLUDED.planned_workouts,
                step_goal           = EXCLUDED.step_goal
            """,
            (
                today,
                plan_json,
                macros["calories"],
                target_protein,
                target_carbs,
                macros["fat"],
                target_fiber,
                round(base_tdee + step_cal + exercise_cal),
                adjusted_deficit,
                adjustment_reason,
                sleep_score,
                training_day,
                False,
                round(exercise_cal),
                round(step_cal),
                planned_workouts,
                step_goal,
            ),
        )
        cur.close()

        # 12. Print summary
        logger.info(
            "Nutrition plan for %s: %d kcal | P %dg C %dg F %dg | "
            "type=%s deficit=%.0f sleep=%.0f step_cal=%.0f ex_cal=%.0f",
            today,
            macros["calories"],
            target_protein,
            target_carbs,
            macros["fat"],
            training_day,
            adjusted_deficit,
            sleep_score,
            step_cal,
            exercise_cal,
        )


if __name__ == "__main__":
    generate_today()
