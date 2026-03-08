"""
One-time initialization script for the adaptive training engine.
Generates the 5-week HM training plan and pushes workouts to Garmin.

Usage:
    cd sync && python3 -m src.training_engine.init_plan

    # Dry run (generate plan, print it, but don't push to Garmin):
    cd sync && python3 -m src.training_engine.init_plan --dry-run
"""
import argparse
import sys
from datetime import date

from db import get_connection
from garmin_client import init_garmin
from training_engine.plan_generator import generate_plan, store_plan
from training_engine.garmin_workout_builder import push_plan_to_garmin


def initialize_training_plan(dry_run: bool = False):
    """Generate training plan and push to Garmin.

    Args:
        dry_run: If True, generate and store the plan but skip Garmin push.
    """
    race_date = date(2026, 4, 12)

    print(f"Generating 5-week HM training plan for race: {race_date}")
    plan = generate_plan(
        race_date=race_date,
        race_distance_km=21.1,
        goal_time_seconds=5700,  # 1:35 (A-goal)
        vdot=47,
        current_longest_run_km=12.0,
    )

    # Print plan summary
    print(f"\nPlan: {plan['plan_name']}")
    print(f"Race: {race_date} ({plan['race_distance_km']} km)")
    print(f"Goal: {plan['goal_time_seconds'] // 60}:{plan['goal_time_seconds'] % 60:02d}")
    print(f"Days: {len(plan['days'])}")
    print()

    current_week = 0
    for day in plan["days"]:
        if day["week_number"] != current_week:
            current_week = day["week_number"]
            print(f"=== WEEK {current_week} ===")

        day_str = day["day_date"].strftime("%a %b %d")
        dist = day["target_distance_km"]
        gym = f" + Gym: {day['gym_workout']}" if day.get("gym_workout") else ""
        steps_count = len(day["workout_steps"]) if day["workout_steps"] else 0
        print(
            f"  {day_str}: {day['run_title']} ({dist} km, {steps_count} steps{gym})"
        )

    # Store in database
    with get_connection() as conn:
        plan_id = store_plan(conn, plan)
        conn.commit()
        print(f"\nPlan stored in database with ID: {plan_id}")

    if dry_run:
        print("\n[DRY RUN] Skipping Garmin push.")
        return plan_id

    # Push to Garmin
    print("\nPushing workouts to Garmin Connect...")
    client = init_garmin()
    with get_connection() as conn:
        pushed = push_plan_to_garmin(conn, client, plan_id)
    print(f"Done! {pushed} workouts pushed to Garmin.")

    return plan_id


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Initialize HM training plan")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Generate plan without pushing to Garmin",
    )
    args = parser.parse_args()

    initialize_training_plan(dry_run=args.dry_run)
