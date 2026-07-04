"""Backfill per-jump kite data into garmin_activity_raw (endpoint 'kite_jumps').

For every kiteboarding activity: download its FIT, extract per-jump
height+position+time from the Surfr Connect IQ `heights` stream, match Surfr's
auto-exported Strava description by start time to enrich the top jumps with
airtime/distance, and store the payload so the share-image route can read it.

Run:  cd sync && .venv/bin/python -m src.backfill_kite_jumps [--only ACTIVITY_ID]
"""

import argparse
import json
import os
import shutil
import sys

import psycopg2

from garmin_client import init_garmin
from garmin_push import _download_fit_file
from kite_jumps import build_kite_jumps

DB_URL = os.environ.get("DATABASE_URL") or ""


def _kite_activities(conn):
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT activity_id, raw_json->>'startTimeGMT'
            FROM garmin_activity_raw
            WHERE endpoint_name = 'summary'
              AND raw_json->'activityType'->>'typeKey' ILIKE '%kite%'
            ORDER BY raw_json->>'startTimeGMT' DESC
            """
        )
        return cur.fetchall()


def _surfr_description(conn, start_time_gmt: str | None) -> str | None:
    """Find the Surfr-exported Strava activity whose UTC start is within 15 min
    of this Garmin activity, and return its corrected description."""
    if not start_time_gmt:
        return None
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT raw_json->>'description'
            FROM strava_raw_data
            WHERE jsonb_typeof(raw_json) = 'object'
              AND raw_json->>'name' ILIKE '%%surfr%%'
              AND raw_json->>'description' ILIKE '%%Top%%Jump%%'
              AND abs(EXTRACT(EPOCH FROM (
                    (raw_json->>'start_date')::timestamptz
                    - (%s || ' UTC')::timestamptz))) < 900
            ORDER BY abs(EXTRACT(EPOCH FROM (
                    (raw_json->>'start_date')::timestamptz
                    - (%s || ' UTC')::timestamptz)))
            LIMIT 1
            """,
            (start_time_gmt, start_time_gmt),
        )
        row = cur.fetchone()
        return row[0] if row else None


def _store(conn, activity_id, payload):
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO garmin_activity_raw (activity_id, endpoint_name, raw_json, synced_at)
            VALUES (%s, 'kite_jumps', %s, NOW())
            ON CONFLICT (activity_id, endpoint_name)
            DO UPDATE SET raw_json = EXCLUDED.raw_json, synced_at = NOW()
            """,
            (activity_id, json.dumps(payload)),
        )


def store_kite_jumps_for_activity(conn, garmin, activity_id, start_gmt: str | None) -> dict:
    """Download the FIT, extract per-jump data (heights, 3D flight paths, native
    airtime/distance), match Surfr's description for enrichment, and store the
    payload under endpoint 'kite_jumps'. Reused by the backfill and the live sync
    hook. Cleans up the downloaded FIT afterwards. Returns the payload."""
    fit_dir = None
    try:
        fit_path = _download_fit_file(garmin, activity_id)
        fit_dir = os.path.dirname(fit_path)
        desc = _surfr_description(conn, start_gmt)
        payload = build_kite_jumps(fit_path, desc)
        _store(conn, activity_id, payload)
        return payload
    finally:
        if fit_dir and os.path.isdir(fit_dir):
            shutil.rmtree(fit_dir, ignore_errors=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", type=int, help="Backfill a single activity id")
    args = ap.parse_args()

    conn = psycopg2.connect(DB_URL)
    conn.autocommit = True
    garmin = init_garmin()

    activities = _kite_activities(conn)
    if args.only:
        activities = [a for a in activities if int(a[0]) == args.only]

    print(f"Backfilling {len(activities)} kite activities")
    done = jumps_total = 0
    for activity_id, start_gmt in activities:
        try:
            payload = store_kite_jumps_for_activity(conn, garmin, activity_id, start_gmt)
            n = payload["summary"]["jump_count"]
            jumps_total += n
            done += 1
            print(
                f"  {activity_id} {start_gmt}: {n} jumps, "
                f"max {payload['summary']['max_height_m']}m"
                f"{' (surfr-enriched)' if payload['summary']['surfr_matched'] else ''}"
            )
        except Exception as exc:  # noqa: BLE001
            print(f"  {activity_id} {start_gmt}: ERROR {exc}", file=sys.stderr)

    print(f"Done: {done}/{len(activities)} activities, {jumps_total} jumps stored")


if __name__ == "__main__":
    main()
