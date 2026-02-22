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


# ===================
# WORKOUT ENRICHMENT
# ===================


def upsert_workout_enrichment(conn, hevy_id: str, **kwargs):
    """Insert or update enrichment data for a Hevy workout."""
    fields = {k: v for k, v in kwargs.items() if v is not None}
    if not fields:
        return
    # Serialize hr_samples to JSON string if present
    if "hr_samples" in fields and isinstance(fields["hr_samples"], list):
        fields["hr_samples"] = json.dumps(fields["hr_samples"])

    cols = ["hevy_id"] + list(fields.keys())
    vals = [hevy_id] + list(fields.values())
    placeholders = ["%s"] * len(vals)
    updates = [f"{k} = EXCLUDED.{k}" for k in fields.keys()] + ["updated_at = NOW()"]

    with conn.cursor() as cur:
        cur.execute(
            f"""
            INSERT INTO workout_enrichment ({', '.join(cols)})
            VALUES ({', '.join(placeholders)})
            ON CONFLICT (hevy_id)
            DO UPDATE SET {', '.join(updates)}
            """,
            vals,
        )


def get_enrichment_by_hevy_id(conn, hevy_id: str) -> dict | None:
    """Get enrichment data for a Hevy workout."""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT * FROM workout_enrichment WHERE hevy_id = %s",
            (hevy_id,),
        )
        return cur.fetchone()


def get_enrichment_by_garmin_id(conn, activity_id: int) -> dict | None:
    """Get enrichment data by Garmin activity ID."""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT * FROM workout_enrichment WHERE garmin_activity_id = %s",
            (activity_id,),
        )
        return cur.fetchone()


def get_outlier_workouts(conn, max_avg_hr: int = 65) -> list[dict]:
    """Get workouts where daily HR was below threshold (calorie outliers)."""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            SELECT * FROM workout_enrichment
            WHERE hr_source = 'daily' AND avg_hr < %s
            ORDER BY workout_date
            """,
            (max_avg_hr,),
        )
        return cur.fetchall()


def get_all_enrichments(conn, limit: int | None = None) -> list[dict]:
    """Get all enrichment records, optionally limited."""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        sql = "SELECT * FROM workout_enrichment ORDER BY workout_date DESC"
        if limit:
            sql += f" LIMIT {int(limit)}"
        cur.execute(sql)
        return cur.fetchall()


# ============================
# STRAVA & SYNC RULE HELPERS
# ============================


def upsert_strava_raw(conn, strava_id: int, endpoint: str, data):
    """Store raw Strava API response. Upsert on (strava_id, endpoint_name)."""
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO strava_raw_data (strava_id, endpoint_name, raw_json)
            VALUES (%s, %s, %s)
            ON CONFLICT (strava_id, endpoint_name)
            DO UPDATE SET raw_json = EXCLUDED.raw_json, synced_at = NOW()
            """,
            (strava_id, endpoint, json.dumps(data) if isinstance(data, (dict, list)) else data),
        )


def upsert_platform_credentials(conn, platform: str, auth_type: str, credentials: dict, expires_at=None):
    """Insert or update platform credentials. Upsert on (platform)."""
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO platform_credentials (platform, auth_type, credentials, expires_at, status, connected_at)
            VALUES (%s, %s, %s, %s, 'active', NOW())
            ON CONFLICT (platform)
            DO UPDATE SET auth_type = EXCLUDED.auth_type,
                         credentials = EXCLUDED.credentials,
                         expires_at = EXCLUDED.expires_at,
                         status = 'active',
                         connected_at = NOW()
            """,
            (platform, auth_type, json.dumps(credentials) if isinstance(credentials, dict) else credentials, expires_at),
        )


def get_platform_credentials(conn, platform: str) -> dict | None:
    """Get credentials for a platform. Returns dict or None."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT platform, auth_type, credentials, expires_at, status "
            "FROM platform_credentials WHERE platform = %s",
            (platform,),
        )
        row = cur.fetchone()
        if not row:
            return None
        creds = row[2]
        if isinstance(creds, str):
            creds = json.loads(creds)
        return {
            "platform": row[0],
            "auth_type": row[1],
            "credentials": creds,
            "expires_at": row[3],
            "status": row[4],
        }


def get_sync_rules(conn, source_platform: str = None, enabled_only: bool = True) -> list[dict]:
    """Get sync rules with optional filters. Returns list of dicts."""
    clauses = []
    params = []
    if source_platform:
        clauses.append("source_platform = %s")
        params.append(source_platform)
    if enabled_only:
        clauses.append("enabled = TRUE")
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            f"SELECT * FROM sync_rules{where} ORDER BY priority DESC",
            params,
        )
        return cur.fetchall()


def log_activity_sync(
    conn,
    source_platform: str,
    source_id: str,
    destination: str,
    destination_id: str = None,
    rule_id: int = None,
    status: str = "sent",
    error_message: str = None,
):
    """Record that an activity was synced (or attempted)."""
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO activity_sync_log
                (source_platform, source_id, destination, destination_id, rule_id, status, error_message)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (source_platform, source_id, destination, destination_id, rule_id, status, error_message),
        )


def was_already_synced(conn, source_platform: str, source_id: str, destination: str) -> bool:
    """Check if an activity was already successfully synced to a destination."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT COUNT(*) FROM activity_sync_log
            WHERE source_platform = %s AND source_id = %s AND destination = %s AND status = 'sent'
            """,
            (source_platform, source_id, destination),
        )
        return cur.fetchone()[0] > 0
