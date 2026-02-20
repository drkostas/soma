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
