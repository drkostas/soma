"""Hevy workout sync — backfill and incremental."""

from db import get_connection, upsert_hevy_raw, update_backfill_progress, get_backfill_progress
from hevy_client import HevyClient


def _get_known_workout_timestamps(conn) -> dict[str, str]:
    """Return {hevy_id: updatedAt} for all workouts in DB."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT hevy_id, raw_json->>'updated_at' as updated_at
            FROM hevy_raw_data
            WHERE endpoint_name = 'workout'
        """)
        return {row[0]: row[1] for row in cur.fetchall()}


def sync_all_workouts(client: HevyClient, start_page: int = 1, page_size: int = 10) -> int:
    """Fetch workouts from Hevy incrementally. Stops when reaching known unchanged workouts.

    Hevy returns workouts newest-first. We compare updatedAt timestamps
    to detect when we've reached data we already have.
    """
    total_count = client.get_workout_count()
    print(f"Hevy reports {total_count} total workouts")

    # Load known timestamps once
    with get_connection() as conn:
        known = _get_known_workout_timestamps(conn)

    saved = 0
    skipped = 0
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

        page_all_known = True
        for workout in workouts:
            wid = workout.get("id", f"page{page}_unknown")
            updated_at = workout.get("updated_at", "")

            # Skip if we already have this exact version
            if wid in known and known[wid] == updated_at:
                skipped += 1
                continue

            page_all_known = False
            try:
                with get_connection() as conn:
                    upsert_hevy_raw(conn, wid, "workout", workout)
                saved += 1
                known[wid] = updated_at  # update local cache
            except Exception as e:
                print(f"  Error saving workout {wid}: {e}")

        page_count = data.get("page_count", page)
        print(f"  Page {page}/{page_count} — {len(workouts)} workouts ({saved} saved this run)")

        # If every workout on this page was already known and unchanged,
        # all older pages will be too — stop early
        if page_all_known:
            remaining = (page_count - page) * page_size
            if remaining > 0:
                print(f"  All workouts on page {page} unchanged — skipping {remaining} older workouts")
            break

        if page >= page_count:
            break
        page += 1

    if skipped:
        print(f"  Skipped {skipped} unchanged workouts")
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
