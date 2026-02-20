"""Database connection and helpers."""

import json
from datetime import date
from contextlib import contextmanager

import psycopg2
import psycopg2.extras

from config import DATABASE_URL


@contextmanager
def get_connection():
    """Yield a database connection, closing it on exit."""
    conn = psycopg2.connect(DATABASE_URL)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def upsert_raw_data(conn, sync_date: date, endpoint: str, data: dict):
    """Store raw API response. Upsert on (date, endpoint_name)."""
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO garmin_raw_data (date, endpoint_name, raw_json)
            VALUES (%s, %s, %s)
            ON CONFLICT (date, endpoint_name)
            DO UPDATE SET raw_json = EXCLUDED.raw_json, synced_at = NOW()
            """,
            (sync_date, endpoint, json.dumps(data)),
        )


def log_sync(conn, sync_type: str, status: str, records: int = 0, error: str = None):
    """Write an entry to the sync_log table."""
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO sync_log (sync_type, status, records_synced, error_message, completed_at)
            VALUES (%s, %s, %s, %s, CASE WHEN %s IN ('success', 'error') THEN NOW() ELSE NULL END)
            """,
            (sync_type, status, records, error, status),
        )


def upsert_hevy_raw(conn, hevy_id: str, endpoint: str, data):
    """Store raw Hevy API response. Upsert on (hevy_id, endpoint_name)."""
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO hevy_raw_data (hevy_id, endpoint_name, raw_json)
            VALUES (%s, %s, %s)
            ON CONFLICT (hevy_id, endpoint_name)
            DO UPDATE SET raw_json = EXCLUDED.raw_json, synced_at = NOW()
            """,
            (hevy_id, endpoint, json.dumps(data) if isinstance(data, (dict, list)) else data),
        )


def upsert_activity_raw(conn, activity_id: int, endpoint: str, data):
    """Store raw Garmin activity detail. Upsert on (activity_id, endpoint_name)."""
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO garmin_activity_raw (activity_id, endpoint_name, raw_json)
            VALUES (%s, %s, %s)
            ON CONFLICT (activity_id, endpoint_name)
            DO UPDATE SET raw_json = EXCLUDED.raw_json, synced_at = NOW()
            """,
            (activity_id, endpoint, json.dumps(data) if isinstance(data, (dict, list)) else data),
        )


def upsert_profile_raw(conn, endpoint: str, data):
    """Store one-time Garmin profile data. Upsert on endpoint_name."""
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO garmin_profile_raw (endpoint_name, raw_json)
            VALUES (%s, %s)
            ON CONFLICT (endpoint_name)
            DO UPDATE SET raw_json = EXCLUDED.raw_json, synced_at = NOW()
            """,
            (endpoint, json.dumps(data) if isinstance(data, (dict, list)) else data),
        )


def get_backfill_progress(conn, source: str) -> dict | None:
    """Get backfill progress for a source. Returns dict or None."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT oldest_date_done, last_page, total_items, items_completed, status "
            "FROM backfill_progress WHERE source = %s",
            (source,),
        )
        row = cur.fetchone()
        if not row:
            return None
        return {
            "oldest_date_done": row[0],
            "last_page": row[1],
            "total_items": row[2],
            "items_completed": row[3],
            "status": row[4],
        }


def update_backfill_progress(conn, source: str, **kwargs):
    """Upsert backfill progress. Pass any of: oldest_date_done, last_page, total_items, items_completed, status."""
    fields = {k: v for k, v in kwargs.items() if v is not None}
    if not fields:
        return
    cols = ["source"] + list(fields.keys()) + ["updated_at"]
    vals = [source] + list(fields.values())
    placeholders = ["%s"] * len(vals) + ["NOW()"]
    updates = [f"{k} = EXCLUDED.{k}" for k in fields.keys()] + ["updated_at = NOW()"]

    with conn.cursor() as cur:
        cur.execute(
            f"""
            INSERT INTO backfill_progress ({', '.join(cols)})
            VALUES ({', '.join(placeholders)})
            ON CONFLICT (source)
            DO UPDATE SET {', '.join(updates)}
            """,
            vals,
        )
