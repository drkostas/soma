"""Hevy workout sync — backfill and incremental."""

from db import get_connection, upsert_hevy_raw, update_backfill_progress, get_backfill_progress
from hevy_client import HevyClient


def sync_all_workouts(client: HevyClient, start_page: int = 1, page_size: int = 10) -> int:
    """Fetch all workouts from Hevy, paginated. Returns total count saved.

    Each workout is committed individually for resume safety.
    start_page allows resuming from where we left off.
    """
    total_count = client.get_workout_count()
    print(f"Hevy reports {total_count} total workouts")

    saved = 0
    page = start_page

    while True:
        try:
            data = client.get_workouts(page=page, page_size=page_size)
        except Exception as e:
            print(f"  Error fetching page {page}: {e}. Will retry on next run.")
            break

        workouts = data.get("workouts", [])
        if not workouts:
            break

        # Save each workout individually with its own commit
        for workout in workouts:
            wid = workout.get("id", f"page{page}_unknown")
            try:
                with get_connection() as conn:
                    upsert_hevy_raw(conn, wid, "workout", workout)
                saved += 1
            except Exception as e:
                print(f"  Error saving workout {wid}: {e}")

        # Update progress after each page
        try:
            with get_connection() as conn:
                update_backfill_progress(
                    conn, "hevy_workouts",
                    last_page=page,
                    total_items=total_count,
                    items_completed=saved + ((start_page - 1) * page_size),
                    status="running",
                )
        except Exception as e:
            print(f"  Warning: couldn't update progress: {e}")

        page_count = data.get("page_count", page)
        print(f"  Page {page}/{page_count} — {len(workouts)} workouts ({saved} saved this run)")

        if page >= page_count:
            # All pages fetched — mark complete
            try:
                with get_connection() as conn:
                    update_backfill_progress(
                        conn, "hevy_workouts",
                        last_page=page,
                        total_items=total_count,
                        items_completed=saved + ((start_page - 1) * page_size),
                        status="complete",
                    )
            except Exception:
                pass
            break
        page += 1

    return saved


def sync_exercise_templates(client: HevyClient, page_size: int = 10) -> int:
    """Fetch all exercise templates from Hevy. Returns count saved."""
    saved = 0
    page = 1

    while True:
        try:
            data = client.get_exercise_templates(page=page, page_size=page_size)
        except Exception as e:
            print(f"  Error fetching templates page {page}: {e}")
            break

        templates = data.get("exercise_templates", [])
        if not templates:
            break

        for tmpl in templates:
            tid = tmpl.get("id", f"tmpl_page{page}")
            try:
                with get_connection() as conn:
                    upsert_hevy_raw(conn, tid, "exercise_template", tmpl)
                saved += 1
            except Exception as e:
                print(f"  Error saving template {tid}: {e}")

        page_count = data.get("page_count", page)
        print(f"  Templates page {page}/{page_count} — {len(templates)} saved")

        if page >= page_count:
            break
        page += 1

    return saved


def sync_routines(client: HevyClient, page_size: int = 10) -> int:
    """Fetch all routines from Hevy. Returns count saved."""
    saved = 0
    page = 1

    while True:
        try:
            data = client.get_routines(page=page, page_size=page_size)
        except Exception as e:
            print(f"  Error fetching routines page {page}: {e}")
            break

        routines = data.get("routines", [])
        if not routines:
            break

        for routine in routines:
            rid = routine.get("id", f"routine_page{page}")
            try:
                with get_connection() as conn:
                    upsert_hevy_raw(conn, rid, "routine", routine)
                saved += 1
            except Exception as e:
                print(f"  Error saving routine {rid}: {e}")

        page_count = data.get("page_count", page)
        print(f"  Routines page {page}/{page_count} — {len(routines)} saved")

        if page >= page_count:
            break
        page += 1

    return saved
