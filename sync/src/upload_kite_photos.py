"""Attach soma kite share images to their Strava activities via the web connector.

Strava has no photo-upload API, so this fetches each kite session's generated share
image from the deployed image endpoint and uploads it through strava_web (Playwright,
headed under xvfb in CI). A small strava_photo_uploads table records what's done so
images are never re-attached.

Run:  cd sync && .venv/bin/python -m src.upload_kite_photos [--only GARMIN_ID] [--limit N]
"""

from __future__ import annotations

import argparse
import os
import tempfile

import psycopg2
import requests

from strava_web import is_configured, upload_photos

DB_URL = os.environ.get("DATABASE_URL") or ""
BASE_URL = os.environ.get("SOMA_BASE_URL", "https://soma.gkos.dev")


def _ensure_table(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS strava_photo_uploads (
                garmin_activity_id BIGINT PRIMARY KEY,
                strava_activity_id BIGINT NOT NULL,
                uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )


def _pending(conn, only: int | None, limit: int) -> list[tuple[int, int]]:
    """(garmin_activity_id, strava_activity_id) for kite sessions with jumps that
    have a matched Strava activity and no photo uploaded yet.

    Match is exact: Strava's external_id is '<garmin_id>_ACTIVITY.fit'."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT DISTINCT k.activity_id, (s.raw_json->>'id')::bigint
            FROM garmin_activity_raw k
            JOIN strava_raw_data s
              ON jsonb_typeof(s.raw_json) = 'object'
             AND s.raw_json->>'external_id' LIKE k.activity_id || '_%%'
            WHERE k.endpoint_name = 'kite_jumps'
              AND (k.raw_json->'summary'->>'jump_count')::int > 0
              AND NOT EXISTS (
                  SELECT 1 FROM strava_photo_uploads u WHERE u.garmin_activity_id = k.activity_id
              )
              AND (%(only)s IS NULL OR k.activity_id = %(only)s)
            ORDER BY k.activity_id DESC
            LIMIT %(limit)s
            """,
            {"only": only, "limit": limit},
        )
        return [(int(g), int(s)) for g, s in cur.fetchall()]


def _mark_done(conn, garmin_id: int, strava_id: int) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO strava_photo_uploads (garmin_activity_id, strava_activity_id) "
            "VALUES (%s, %s) ON CONFLICT (garmin_activity_id) DO NOTHING",
            (garmin_id, strava_id),
        )


def _fetch_image(garmin_id: int) -> str | None:
    """Fetch the share image from the deployed endpoint; return a temp file path."""
    resp = requests.get(f"{BASE_URL}/api/activity/{garmin_id}/image", timeout=90)
    if resp.status_code != 200 or not resp.content:
        print(f"  {garmin_id}: image fetch failed ({resp.status_code})")
        return None
    fd, path = tempfile.mkstemp(prefix=f"kite_{garmin_id}_", suffix=".png")
    with os.fdopen(fd, "wb") as f:
        f.write(resp.content)
    return path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", type=int, help="single Garmin activity id")
    ap.add_argument("--limit", type=int, default=10)
    args = ap.parse_args()

    if not is_configured():
        print("Strava web connector not configured (STRAVA_WEB_EMAIL/PASSWORD) — skipping.")
        return

    conn = psycopg2.connect(DB_URL)
    conn.autocommit = True
    _ensure_table(conn)
    pending = _pending(conn, args.only, args.limit)
    if not pending:
        print("No kite activities pending a Strava photo.")
        return
    print(f"{len(pending)} kite activities pending a Strava photo.")

    items, meta = [], []
    for garmin_id, strava_id in pending:
        path = _fetch_image(garmin_id)
        if path:
            items.append((strava_id, path))
            meta.append((garmin_id, strava_id))

    results = upload_photos(items, conn=conn)
    ok_count = 0
    for (strava_id, ok), (garmin_id, _) in zip(results, meta):
        if ok:
            _mark_done(conn, garmin_id, strava_id)
            ok_count += 1
    print(f"Done: {ok_count}/{len(meta)} photos attached.")


if __name__ == "__main__":
    main()
