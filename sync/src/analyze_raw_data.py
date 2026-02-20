"""Analyze raw data lake contents to inform Layer 2 schema design.

Generates a comprehensive report of:
- Date coverage per Garmin endpoint
- Field population rates
- Activity type breakdown
- Hevy workout statistics
"""

import json
from collections import Counter
from db import get_connection


def analyze_garmin_daily():
    """Analyze garmin_raw_data coverage and field population."""
    print("=" * 60)
    print("GARMIN DAILY DATA ANALYSIS")
    print("=" * 60)

    with get_connection() as conn:
        with conn.cursor() as cur:
            # Overall stats
            cur.execute("SELECT COUNT(*), COUNT(DISTINCT date), COUNT(DISTINCT endpoint_name) FROM garmin_raw_data")
            total, days, endpoints = cur.fetchone()
            print(f"\nTotal records: {total}")
            print(f"Unique dates: {days}")
            print(f"Unique endpoints: {endpoints}")

            # Date range
            cur.execute("SELECT MIN(date), MAX(date) FROM garmin_raw_data")
            min_date, max_date = cur.fetchone()
            print(f"Date range: {min_date} to {max_date}")

            # Per-endpoint coverage
            cur.execute("""
                SELECT endpoint_name, COUNT(*) as cnt,
                       MIN(date) as first_date, MAX(date) as last_date
                FROM garmin_raw_data
                GROUP BY endpoint_name
                ORDER BY cnt DESC
            """)
            print(f"\n{'Endpoint':<30} {'Count':>6} {'First Date':>12} {'Last Date':>12}")
            print("-" * 65)
            for name, cnt, first, last in cur.fetchall():
                print(f"{name:<30} {cnt:>6} {str(first):>12} {str(last):>12}")

            # Field analysis for key endpoints
            for ep_name in ["user_summary", "sleep_data", "hrv_data", "training_readiness", "training_status"]:
                cur.execute(
                    "SELECT raw_json FROM garmin_raw_data WHERE endpoint_name = %s LIMIT 100",
                    (ep_name,),
                )
                rows = cur.fetchall()
                if not rows:
                    continue

                print(f"\n--- {ep_name} field analysis (sample: {len(rows)} records) ---")
                field_counts = Counter()
                for (raw,) in rows:
                    data = raw if isinstance(raw, dict) else {}
                    for key in data.keys():
                        field_counts[key] += 1

                for field, count in field_counts.most_common(30):
                    pct = count / len(rows) * 100
                    print(f"  {field:<40} {pct:>5.1f}%")


def analyze_garmin_activities():
    """Analyze Garmin activity data."""
    print("\n" + "=" * 60)
    print("GARMIN ACTIVITIES ANALYSIS")
    print("=" * 60)

    with get_connection() as conn:
        with conn.cursor() as cur:
            # Total activities
            cur.execute("SELECT COUNT(DISTINCT activity_id) FROM garmin_activity_raw")
            (total,) = cur.fetchone()
            print(f"\nTotal unique activities: {total}")

            if total == 0:
                print("No activity data yet.")
                return

            # Endpoints per activity
            cur.execute("""
                SELECT endpoint_name, COUNT(*)
                FROM garmin_activity_raw
                GROUP BY endpoint_name
                ORDER BY COUNT(*) DESC
            """)
            print(f"\n{'Detail Endpoint':<25} {'Count':>8}")
            print("-" * 35)
            for name, cnt in cur.fetchall():
                print(f"{name:<25} {cnt:>8}")

            # Activity type breakdown from details
            cur.execute("""
                SELECT raw_json->>'activityTypeDTO' as activity_type
                FROM garmin_activity_raw
                WHERE endpoint_name = 'details'
                LIMIT 500
            """)
            type_counts = Counter()
            for (type_json,) in cur.fetchall():
                if type_json:
                    try:
                        type_data = json.loads(type_json) if isinstance(type_json, str) else type_json
                        type_name = type_data.get("typeKey", "unknown") if isinstance(type_data, dict) else "unknown"
                        type_counts[type_name] += 1
                    except (json.JSONDecodeError, AttributeError):
                        type_counts["parse_error"] += 1

            if type_counts:
                print(f"\nActivity types:")
                for type_name, cnt in type_counts.most_common(20):
                    print(f"  {type_name:<30} {cnt:>5}")


def analyze_hevy():
    """Analyze Hevy workout data."""
    print("\n" + "=" * 60)
    print("HEVY DATA ANALYSIS")
    print("=" * 60)

    with get_connection() as conn:
        with conn.cursor() as cur:
            # Counts by endpoint
            cur.execute("""
                SELECT endpoint_name, COUNT(*)
                FROM hevy_raw_data
                GROUP BY endpoint_name
                ORDER BY endpoint_name
            """)
            results = cur.fetchall()
            if not results:
                print("\nNo Hevy data yet.")
                return

            for name, cnt in results:
                print(f"  {name}: {cnt}")

            # Workout analysis
            cur.execute("""
                SELECT raw_json FROM hevy_raw_data
                WHERE endpoint_name = 'workout'
                ORDER BY raw_json->>'start_time' DESC
            """)
            workouts = cur.fetchall()

            if not workouts:
                return

            print(f"\nTotal workouts: {len(workouts)}")

            exercise_counts = Counter()
            total_sets = 0
            total_exercises = 0
            rpe_count = 0
            set_count = 0

            for (raw,) in workouts:
                w = raw if isinstance(raw, dict) else {}
                exercises = w.get("exercises", [])
                total_exercises += len(exercises)
                for ex in exercises:
                    exercise_counts[ex.get("title", "unknown")] += 1
                    sets = ex.get("sets", [])
                    total_sets += len(sets)
                    for s in sets:
                        set_count += 1
                        if s.get("rpe") is not None:
                            rpe_count += 1

            n = len(workouts)
            print(f"Avg exercises/workout: {total_exercises / n:.1f}")
            print(f"Avg sets/workout: {total_sets / n:.1f}")
            if set_count:
                print(f"RPE logged: {rpe_count}/{set_count} sets ({rpe_count / set_count * 100:.1f}%)")

            # Date range
            cur.execute("""
                SELECT MIN(raw_json->>'start_time'), MAX(raw_json->>'start_time')
                FROM hevy_raw_data WHERE endpoint_name = 'workout'
            """)
            min_time, max_time = cur.fetchone()
            print(f"Date range: {min_time[:10] if min_time else '?'} to {max_time[:10] if max_time else '?'}")

            print(f"\nTop 15 exercises:")
            for name, cnt in exercise_counts.most_common(15):
                print(f"  {name:<35} {cnt:>5}")


def analyze_profile():
    """Show what profile data we have."""
    print("\n" + "=" * 60)
    print("GARMIN PROFILE DATA")
    print("=" * 60)

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT endpoint_name, synced_at FROM garmin_profile_raw ORDER BY endpoint_name")
            rows = cur.fetchall()
            if not rows:
                print("\nNo profile data yet.")
                return
            for name, synced in rows:
                print(f"  {name:<25} synced: {synced}")


def analyze_backfill_status():
    """Show backfill progress for all sources."""
    print("\n" + "=" * 60)
    print("BACKFILL STATUS")
    print("=" * 60)

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM backfill_progress ORDER BY source")
            rows = cur.fetchall()
            if not rows:
                print("\nNo backfill data. Run backfill.py first.")
                return
            for row in rows:
                print(f"\n  Source: {row[0]}")
                print(f"  Oldest date done: {row[1]}")
                print(f"  Last page: {row[2]}")
                print(f"  Progress: {row[4]}/{row[3]}")
                print(f"  Status: {row[5]}")


def main():
    analyze_backfill_status()
    analyze_garmin_daily()
    analyze_garmin_activities()
    analyze_hevy()
    analyze_profile()
    print("\n" + "=" * 60)
    print("ANALYSIS COMPLETE")
    print("=" * 60)


if __name__ == "__main__":
    main()
