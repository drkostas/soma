#!/usr/bin/env python3
"""Regenerate workout_steps JSONB for existing training_plan_day rows.

Applies updated step builders (HR zones on recovery jogs, pace ranges on intervals)
to all future plan days that haven't been pushed to Garmin yet.

Usage: cd sync && PYTHONPATH=src python3 -m training_engine.regenerate_workout_steps
"""
import json
import logging
from datetime import date

from db import get_connection
from training_engine.plan_generator import (
    all_paces,
    hm_goal_paces,
    build_easy_run_steps,
    build_easy_with_strides_steps,
    build_long_run_steps,
    build_cruise_intervals_steps,
    build_vo2max_intervals_steps,
    build_hm_pace_intervals_steps,
    build_hm_tempo_steps,
    build_threshold_plus_speed_steps,
    build_progression_long_run_steps,
    build_sharpener_steps,
    build_final_sharpener_steps,
    build_shakeout_steps,
    build_race_steps,
    build_rest_day,
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# Must match the VDOT used when the plan was generated
PLAN_VDOT = 47


def regenerate():
    paces = all_paces(PLAN_VDOT)
    goals = hm_goal_paces(PLAN_VDOT)

    e_min, e_max = paces["E"]
    t_pace = paces["T"][0]
    i_pace = paces["I"][0]
    r_min, r_max = paces["R"]
    b_goal = goals["B"]
    a_goal = goals["A"]
    c_goal = goals["C"]

    # Map run_title patterns to step builder calls
    def build_steps(run_title: str, target_distance_km: float, week_number: int):
        title = run_title.strip()

        if title == "REST":
            return build_rest_day()

        if title == "RACE DAY":
            return build_race_steps(21.1, a_goal)

        if "Shakeout" in title:
            return build_shakeout_steps(target_distance_km, e_min, e_max, 3)

        if title == "Final Sharpener":
            return build_final_sharpener_steps(2.0, 2, b_goal, 4, r_min, r_max, 2.0, e_min, e_max)

        if title == "Sharpener":
            return build_sharpener_steps(3, 1600, b_goal, 120, 2.0, 2.0, e_min, e_max, "Sharpener")

        if title == "Cruise Intervals":
            if week_number == 1:
                return build_cruise_intervals_steps(4, 1600, t_pace, 90, 2.0, 2.0, e_min, e_max)
            elif week_number == 3:
                return build_cruise_intervals_steps(5, 1000, t_pace, 60, 2.0, 2.0, e_min, e_max)
            return build_cruise_intervals_steps(4, 1600, t_pace, 90, 2.0, 2.0, e_min, e_max)

        if title == "VO2max Intervals":
            return build_vo2max_intervals_steps(5, 1000, i_pace, 180, 2.0, 2.0, e_min, e_max)

        if title == "HM-Pace Tempo":
            return build_hm_pace_intervals_steps(3, 2000, b_goal, 120, 2.0, 2.0, e_min, e_max)

        if title == "Race-Pace Tempo":
            return build_hm_tempo_steps(7.0, b_goal, 2.0, 2.0, e_min, e_max)

        if title == "Threshold + Speed":
            return build_threshold_plus_speed_steps(
                3, 1600, t_pace, 90,
                4, 200, r_min, r_max, 200,
                2.0, 1.0, e_min, e_max,
            )

        if "Long Run (Progression)" in title:
            return build_progression_long_run_steps([
                (15, e_min, e_max, "Easy 15 km"),
                (2, c_goal, c_goal, "Progress to C-goal pace"),
                (2, b_goal, b_goal, "Progress to B-goal pace"),
                (1, t_pace, t_pace, "Finish at T-pace"),
            ])

        if "Long Run (Fast Finish)" in title:
            return build_long_run_steps(target_distance_km, e_min, e_max,
                                        fast_finish_km=3, fast_finish_pace_min=290, fast_finish_pace_max=295)

        if "Long Run" in title or "Easy Long" in title:
            return build_long_run_steps(target_distance_km, e_min, e_max)

        if "Strides" in title:
            stride_count = 6
            if week_number >= 4:
                stride_count = 4
            if week_number == 5 and target_distance_km <= 4:
                stride_count = 3
            return build_easy_with_strides_steps(
                target_distance_km, e_min, e_max, stride_count, r_min, r_max)

        if "Easy Run" in title or "Rest or Easy" in title:
            return build_easy_run_steps(target_distance_km, e_min, e_max)

        logger.warning("Unrecognized run_title: %s — skipping", title)
        return None

    with get_connection() as conn:
        with conn.cursor() as cur:
            # Get all future plan days that haven't been pushed yet
            cur.execute("""
                SELECT d.id, d.run_title, d.target_distance_km, d.week_number,
                       d.garmin_push_status, d.day_date
                FROM training_plan_day d
                WHERE d.day_date >= CURRENT_DATE
                  AND d.run_type != 'rest'
                ORDER BY d.day_date
            """)
            rows = cur.fetchall()

        updated = 0
        skipped = 0
        for day_id, run_title, target_km, week_num, push_status, day_date in rows:
            new_steps = build_steps(run_title, target_km, week_num)
            if new_steps is None:
                skipped += 1
                continue

            with conn.cursor() as cur:
                cur.execute("""
                    UPDATE training_plan_day
                    SET workout_steps = %s,
                        garmin_push_status = CASE
                            WHEN garmin_push_status = 'pushed' THEN 'pending'
                            ELSE garmin_push_status
                        END
                    WHERE id = %s
                """, (json.dumps(new_steps), day_id))
            updated += 1
            logger.info("  Updated day %s (%s): %s", day_date, run_title, push_status)

        conn.commit()
        logger.info("\nDone: %d days updated, %d skipped", updated, skipped)


if __name__ == "__main__":
    regenerate()
