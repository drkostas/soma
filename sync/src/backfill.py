"""Backfill orchestrator with bulletproof resume capability.

Designed to survive:
- Laptop sleep/wake (reconnects to DB on each operation)
- Network drops (retry with exponential backoff)
- Ctrl+C (SIGINT handled gracefully, progress saved)
- Process kill (progress saved after every record)
- Garmin 429 rate limits (extended backoff)
- Endpoints that don't exist for old dates (skip and continue)
"""

import signal
import sys
import time
from datetime import date, timedelta

from db import (
    get_connection,
    upsert_raw_data,
    upsert_activity_raw,
    upsert_profile_raw,
    get_backfill_progress,
    update_backfill_progress,
    log_sync,
)
from garmin_client import init_garmin, rate_limited_call
from garmin_sync import (
    DAILY_ENDPOINTS,
    RANGE_ENDPOINTS,
    ACTIVITY_DETAIL_ENDPOINTS,
    PROFILE_ENDPOINTS,
    sync_activity_details,
    sync_profile,
)
from hevy_client import HevyClient
from hevy_sync import sync_all_workouts, sync_exercise_templates, sync_routines

# How far back to go for Garmin backfill
GARMIN_START_YEAR = 2021


def _safe_db_op(operation, *args, max_retries=3, **kwargs):
    """Execute a DB operation with connection retry.

    Handles stale connections from laptop sleep/wake by reconnecting.
    Each call gets a fresh connection to avoid stale connection issues.
    """
    for attempt in range(max_retries):
        try:
            with get_connection() as conn:
                result = operation(conn, *args, **kwargs)
                return result
        except Exception as e:
            err_str = str(e).lower()
            is_connection_error = any(word in err_str for word in [
                "connection", "timeout", "broken pipe", "reset by peer",
                "ssl", "eof", "closed", "terminated",
            ])
            if is_connection_error and attempt < max_retries - 1:
                wait = (attempt + 1) * 5
                print(f"    DB connection error (attempt {attempt + 1}): {e}")
                print(f"    Retrying in {wait}s...")
                time.sleep(wait)
            else:
                raise


class GarminBackfill:
    """Backfill all Garmin daily data with resume capability."""

    def __init__(self):
        self._shutdown = False
        self.today = date.today()
        self.start_year = GARMIN_START_YEAR
        self.client = None

        # Register SIGINT handler for graceful shutdown
        signal.signal(signal.SIGINT, self._handle_shutdown)
        signal.signal(signal.SIGTERM, self._handle_shutdown)

    def _handle_shutdown(self, signum, frame):
        print("\n\nShutdown signal received. Finishing current record and saving progress...")
        self._shutdown = True

    def _generate_date_range(self, oldest_done: date | None) -> list[date]:
        """Generate list of dates to process, newest to oldest."""
        start = date(self.start_year, 1, 1)
        if oldest_done:
            # Resume: continue from the day before where we stopped
            end = oldest_done - timedelta(days=1)
        else:
            # Fresh start: begin from today
            end = self.today

        if end < start:
            return []

        dates = []
        current = end
        while current >= start:
            dates.append(current)
            current -= timedelta(days=1)
        return dates

    def _ensure_client(self):
        """Ensure Garmin client is authenticated. Re-auth if needed."""
        if self.client is None:
            print("Authenticating with Garmin Connect...")
            self.client = init_garmin()
            print("Authenticated.\n")

    def _sync_day_safe(self, sync_date: date) -> int:
        """Sync all endpoints for a day with per-endpoint DB commits and connection retry."""
        date_str = sync_date.isoformat()
        count = 0

        for endpoint_name, fetch_fn in DAILY_ENDPOINTS.items():
            if self._shutdown:
                return count
            try:
                data = rate_limited_call(fetch_fn, self.client, date_str)
                if data:
                    _safe_db_op(upsert_raw_data, sync_date, endpoint_name, data)
                    count += 1
            except Exception as e:
                err = str(e)
                if "429" in err or "Too Many" in err:
                    print(f"    Rate limited on {endpoint_name}. Waiting 60s...")
                    time.sleep(60)
                # else: skip silently -- many endpoints don't exist for old dates

        for endpoint_name, fetch_fn in RANGE_ENDPOINTS.items():
            if self._shutdown:
                return count
            try:
                data = rate_limited_call(fetch_fn, self.client, date_str, date_str)
                if data:
                    _safe_db_op(upsert_raw_data, sync_date, endpoint_name, data)
                    count += 1
            except Exception:
                pass

        return count

    def _discover_and_sync_activities(self, sync_date: date):
        """Find activities for a date and fetch their details."""
        date_str = sync_date.isoformat()
        try:
            activities = rate_limited_call(
                self.client.get_activities_by_date, date_str, date_str
            )
            if not activities:
                return

            # Store activity list
            _safe_db_op(upsert_raw_data, sync_date, "activities_list", activities)

            for activity in activities:
                if self._shutdown:
                    return
                aid = activity.get("activityId")
                if not aid:
                    continue

                for ep_name, fetch_fn in ACTIVITY_DETAIL_ENDPOINTS.items():
                    if self._shutdown:
                        return
                    try:
                        data = rate_limited_call(fetch_fn, self.client, aid)
                        if data:
                            _safe_db_op(upsert_activity_raw, aid, ep_name, data)
                    except Exception:
                        pass  # Skip failed detail endpoints

        except Exception as e:
            if "429" in str(e):
                print(f"    Rate limited on activities. Waiting 60s...")
                time.sleep(60)

    def run(self):
        """Run the Garmin backfill. Can be interrupted and resumed."""
        self._ensure_client()

        # Check prior progress
        progress = _safe_db_op(get_backfill_progress, "garmin_daily")
        oldest_done = progress["oldest_date_done"] if progress else None
        items_done = progress["items_completed"] if progress else 0

        dates = self._generate_date_range(oldest_done)
        if not dates:
            print("Garmin backfill complete -- no dates remaining.")
            return

        total = len(dates)
        print(f"Garmin backfill: {total} days remaining")
        if oldest_done:
            print(f"Resuming from {oldest_done - timedelta(days=1)} backwards")
        print(f"Estimated time: ~{total * 25 // 3600}h {(total * 25 % 3600) // 60}m\n")

        for i, sync_date in enumerate(dates):
            if self._shutdown:
                print(f"\nGraceful shutdown. Progress saved at {sync_date}.")
                print(f"Run again to resume from {sync_date}.")
                break

            count = self._sync_day_safe(sync_date)
            self._discover_and_sync_activities(sync_date)

            # Update progress after EVERY day (survive any crash)
            items_done += 1
            try:
                _safe_db_op(
                    update_backfill_progress, "garmin_daily",
                    oldest_date_done=sync_date,
                    total_items=total + (progress["items_completed"] if progress else 0),
                    items_completed=items_done,
                    status="running",
                )
            except Exception as e:
                print(f"  Warning: progress update failed: {e}")

            pct = (i + 1) / total * 100
            print(f"[{i+1}/{total}] {sync_date} -- {count} endpoints ({pct:.1f}%)", flush=True)

        # Mark complete if we finished all dates
        if not self._shutdown:
            try:
                _safe_db_op(
                    update_backfill_progress, "garmin_daily",
                    status="complete",
                    items_completed=items_done,
                )
            except Exception:
                pass
            print(f"\nGarmin backfill complete! {items_done} days processed.")

    def run_profile(self):
        """Fetch one-time profile data."""
        self._ensure_client()
        print("Fetching Garmin profile data...")
        count = sync_profile(self.client)
        print(f"Profile sync complete: {count} endpoints saved.")

    def status(self):
        """Print current backfill progress."""
        progress = _safe_db_op(get_backfill_progress, "garmin_daily")
        if not progress:
            print("Garmin backfill: not started")
            return

        total = progress["total_items"] or "?"
        done = progress["items_completed"]
        oldest = progress["oldest_date_done"]
        status = progress["status"]
        pct = (done / total * 100) if isinstance(total, int) and total > 0 else 0
        print(f"Garmin backfill: {status}")
        print(f"  Days completed: {done}/{total} ({pct:.1f}%)")
        print(f"  Oldest date done: {oldest}")


class GarminActivityBackfill:
    """Backfill all Garmin activity details using paginated get_activities.

    Much faster than per-day discovery since it skips days with no activities
    and uses Garmin's native pagination.
    """

    ACTIVITIES_PER_PAGE = 20  # Garmin default page size

    def __init__(self):
        self._shutdown = False
        self.client = None

        signal.signal(signal.SIGINT, self._handle_shutdown)
        signal.signal(signal.SIGTERM, self._handle_shutdown)

    def _handle_shutdown(self, signum, frame):
        print("\n\nShutdown signal received. Progress saved.", flush=True)
        self._shutdown = True

    def _ensure_client(self):
        if self.client is None:
            print("Authenticating with Garmin Connect...")
            self.client = init_garmin()
            print("Authenticated.\n")

    def run(self):
        """Paginate through all activities and fetch details for each."""
        self._ensure_client()

        # Check prior progress
        progress = _safe_db_op(get_backfill_progress, "garmin_activities")
        start_index = 0
        activities_done = 0
        if progress and progress["items_completed"]:
            start_index = progress["items_completed"]
            activities_done = start_index
            print(f"Resuming from activity index {start_index}")

        print(f"Fetching activities starting from index {start_index}...\n")

        page_start = start_index
        total_new = 0
        batch_count = 0

        while not self._shutdown:
            try:
                activities = rate_limited_call(
                    self.client.get_activities, page_start, self.ACTIVITIES_PER_PAGE
                )
            except Exception as e:
                if "429" in str(e):
                    print(f"  Rate limited. Waiting 60s...", flush=True)
                    time.sleep(60)
                    continue
                else:
                    print(f"  Error fetching activities at index {page_start}: {e}", flush=True)
                    break

            if not activities:
                print(f"\nNo more activities. Reached end at index {page_start}.")
                break

            for activity in activities:
                if self._shutdown:
                    break

                aid = activity.get("activityId")
                if not aid:
                    continue

                activity_name = activity.get("activityName", "?")
                activity_type = activity.get("activityType", {}).get("typeKey", "?")
                start_time = activity.get("startTimeLocal", "?")

                # Store the activity summary itself
                try:
                    _safe_db_op(upsert_activity_raw, aid, "summary", activity)
                except Exception:
                    pass

                # Fetch detail endpoints
                details_saved = 0
                for ep_name, fetch_fn in ACTIVITY_DETAIL_ENDPOINTS.items():
                    if self._shutdown:
                        break
                    try:
                        data = rate_limited_call(fetch_fn, self.client, aid)
                        if data:
                            _safe_db_op(upsert_activity_raw, aid, ep_name, data)
                            details_saved += 1
                    except Exception as e:
                        if "429" in str(e):
                            print(f"    Rate limited on {ep_name}. Waiting 60s...", flush=True)
                            time.sleep(60)
                        # else skip silently

                activities_done += 1
                total_new += 1
                batch_count += 1
                print(
                    f"  [{activities_done}] {start_time} {activity_type}: "
                    f"{activity_name} -- {details_saved} details",
                    flush=True,
                )

            # Save progress after each page
            page_start += len(activities)
            try:
                _safe_db_op(
                    update_backfill_progress, "garmin_activities",
                    items_completed=activities_done,
                    last_page=page_start,
                    status="running",
                )
            except Exception as e:
                print(f"  Warning: progress update failed: {e}", flush=True)

            print(
                f"  -- Page complete. {total_new} activities processed so far.\n",
                flush=True,
            )

        # Mark complete if we finished
        if not self._shutdown:
            try:
                _safe_db_op(
                    update_backfill_progress, "garmin_activities",
                    status="complete",
                    items_completed=activities_done,
                    total_items=activities_done,
                )
            except Exception:
                pass
            print(f"\nActivity backfill complete! {total_new} activities processed.")
        else:
            print(f"\nStopped. {total_new} activities processed this run. Resume to continue.")

    def status(self):
        """Print current activity backfill progress."""
        progress = _safe_db_op(get_backfill_progress, "garmin_activities")
        if not progress:
            print("Activity backfill: not started")
            return
        print(f"Activity backfill: {progress['status']}")
        print(f"  Activities processed: {progress['items_completed']}")
        print(f"  Last index: {progress['last_page']}")


class HevyBackfill:
    """Backfill all Hevy data with resume capability."""

    def __init__(self):
        self._shutdown = False
        self.client = HevyClient()
        self.start_page = 1

        # Check prior progress
        progress = _safe_db_op(get_backfill_progress, "hevy_workouts")
        if progress and progress["last_page"]:
            self.start_page = progress["last_page"] + 1
            print(f"Resuming Hevy from page {self.start_page}")

        signal.signal(signal.SIGINT, self._handle_shutdown)
        signal.signal(signal.SIGTERM, self._handle_shutdown)

    def _handle_shutdown(self, signum, frame):
        print("\n\nShutdown signal received. Progress already saved per-page.")
        self._shutdown = True

    def run(self):
        """Run the full Hevy backfill."""
        print("=== Hevy Backfill ===\n")

        # 1. Workouts
        print("Syncing workouts...")
        workout_count = sync_all_workouts(self.client, start_page=self.start_page)
        print(f"Workouts saved: {workout_count}\n")

        if self._shutdown:
            return

        # 2. Exercise templates
        print("Syncing exercise templates...")
        template_count = sync_exercise_templates(self.client)
        print(f"Templates saved: {template_count}\n")

        if self._shutdown:
            return

        # 3. Routines
        print("Syncing routines...")
        routine_count = sync_routines(self.client)
        print(f"Routines saved: {routine_count}\n")

        # Mark complete
        try:
            _safe_db_op(
                update_backfill_progress, "hevy_workouts",
                status="complete",
            )
        except Exception:
            pass

        print(f"=== Hevy backfill complete ===")
        print(f"  Workouts: {workout_count}")
        print(f"  Templates: {template_count}")
        print(f"  Routines: {routine_count}")

    def status(self):
        """Print Hevy backfill status."""
        progress = _safe_db_op(get_backfill_progress, "hevy_workouts")
        if not progress:
            print("Hevy backfill: not started")
            return
        print(f"Hevy backfill: {progress['status']}")
        print(f"  Last page: {progress['last_page']}")
        print(f"  Items: {progress['items_completed']}/{progress['total_items']}")


def main():
    if len(sys.argv) < 2:
        print("Usage: python backfill.py <garmin|garmin-activities|garmin-profile|hevy> [--status]")
        sys.exit(1)

    source = sys.argv[1]
    check_status = "--status" in sys.argv

    if source == "garmin":
        bf = GarminBackfill()
        if check_status:
            bf.status()
        else:
            bf.run()
    elif source == "garmin-activities":
        bf = GarminActivityBackfill()
        if check_status:
            bf.status()
        else:
            bf.run()
    elif source == "garmin-profile":
        bf = GarminBackfill()
        bf.run_profile()
    elif source == "hevy":
        bf = HevyBackfill()
        if check_status:
            bf.status()
        else:
            bf.run()
    else:
        print(f"Unknown source: {source}")
        print("Use: garmin, garmin-activities, garmin-profile, or hevy")
        sys.exit(1)


if __name__ == "__main__":
    main()
