"""Reconcile existing Strava activities with Garmin/Hevy sources.

Matches Strava activities to Garmin/Hevy activities by timestamp (±120 seconds).
Creates 'external' entries in activity_sync_log for activities already on Strava
via native sync (not pushed by our system).

Usage:
    python -m src.reconciler
"""

from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timezone

from db import get_connection, log_activity_sync

logger = logging.getLogger(__name__)

# Maximum time difference (seconds) for matching activities across platforms
MATCH_WINDOW_SECONDS = 120


def _parse_timestamp(ts: str) -> float | None:
    """Parse various timestamp formats to epoch seconds."""
    if not ts:
        return None
    try:
        # ISO 8601 with timezone
        if "T" in ts and ("Z" in ts or "+" in ts):
            dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            return dt.timestamp()
        # ISO 8601 without timezone (assume UTC)
        if "T" in ts:
            dt = datetime.fromisoformat(ts).replace(tzinfo=timezone.utc)
            return dt.timestamp()
        # Garmin format: "2026-02-20 14:30:00"
        dt = datetime.strptime(ts, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
        return dt.timestamp()
    except (ValueError, TypeError):
        return None


def _load_strava_activities(conn) -> list[dict]:
    """Load all Strava activities from strava_raw_data."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT strava_id, raw_json
            FROM strava_raw_data
            WHERE endpoint_name = 'activity'
        """)
        rows = cur.fetchall()

    activities = []
    for strava_id, raw in rows:
        if isinstance(raw, str):
            raw = json.loads(raw)
        start = raw.get("start_date") or raw.get("start_date_local")
        activities.append({
            "strava_id": str(strava_id),
            "start_epoch": _parse_timestamp(start),
            "name": raw.get("name", ""),
            "type": raw.get("type", ""),
            "elapsed_time": raw.get("elapsed_time"),
        })
    return [a for a in activities if a["start_epoch"] is not None]


def _load_garmin_activities(conn) -> list[dict]:
    """Load Garmin activity summaries."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT activity_id, raw_json
            FROM garmin_activity_raw
            WHERE endpoint_name = 'summary'
        """)
        rows = cur.fetchall()

    activities = []
    for activity_id, raw in rows:
        if isinstance(raw, str):
            raw = json.loads(raw)
        start = raw.get("startTimeGMT") or raw.get("startTimeLocal")
        activities.append({
            "source_id": str(activity_id),
            "platform": "garmin",
            "start_epoch": _parse_timestamp(start),
            "name": raw.get("activityName", ""),
        })
    return [a for a in activities if a["start_epoch"] is not None]


def _load_hevy_activities(conn) -> list[dict]:
    """Load Hevy workout activities."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT hevy_id, raw_json
            FROM hevy_raw_data
            WHERE endpoint_name = 'workout'
        """)
        rows = cur.fetchall()

    activities = []
    for hevy_id, raw in rows:
        if isinstance(raw, str):
            raw = json.loads(raw)
        start = raw.get("start_time")
        activities.append({
            "source_id": hevy_id,
            "platform": "hevy",
            "start_epoch": _parse_timestamp(start),
            "name": raw.get("title", ""),
        })
    return [a for a in activities if a["start_epoch"] is not None]


def _load_existing_sync_entries(conn) -> set[tuple[str, str, str]]:
    """Load existing activity_sync_log entries as (source_platform, source_id, destination) tuples."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT source_platform, source_id, destination
            FROM activity_sync_log
            WHERE destination = 'strava'
              AND status IN ('sent', 'external')
        """)
        return {(r[0], r[1], r[2]) for r in cur.fetchall()}


def reconcile_strava_syncs() -> int:
    """Match Strava activities to Garmin/Hevy sources and create 'external' sync log entries.

    Two matching passes:
      1. Timestamp-based (±120s) — works for native Garmin watch activities
      2. Name + same-day fallback — handles DEVELOPMENT uploads where FIT timezone
         is wrong (Hevy local-time-as-UTC), causing ~7h offset on Strava

    Returns the count of newly reconciled activities.
    """
    with get_connection() as conn:
        strava = _load_strava_activities(conn)
        garmin = _load_garmin_activities(conn)
        hevy = _load_hevy_activities(conn)
        existing = _load_existing_sync_entries(conn)

    if not strava:
        logger.info("No Strava activities found for reconciliation.")
        return 0

    all_sources = sorted(garmin + hevy, key=lambda a: a["start_epoch"])
    reconciled = 0
    matched_strava_ids = set()

    # Pass 1: Timestamp-based matching (±120s)
    for sa in strava:
        strava_epoch = sa["start_epoch"]
        best_match = None
        best_diff = float("inf")

        for src in all_sources:
            diff = abs(src["start_epoch"] - strava_epoch)
            if diff <= MATCH_WINDOW_SECONDS and diff < best_diff:
                best_diff = diff
                best_match = src

        if best_match is None:
            continue

        key = (best_match["platform"], best_match["source_id"], "strava")
        if key in existing:
            matched_strava_ids.add(sa["strava_id"])
            continue

        with get_connection() as conn:
            log_activity_sync(
                conn,
                source_platform=best_match["platform"],
                source_id=best_match["source_id"],
                destination="strava",
                destination_id=sa["strava_id"],
                status="external",
            )

        existing.add(key)
        matched_strava_ids.add(sa["strava_id"])
        reconciled += 1
        logger.debug(
            "Reconciled (timestamp): %s:%s → strava:%s (diff=%.0fs)",
            best_match["platform"], best_match["source_id"],
            sa["strava_id"], best_diff,
        )

    # Pass 2: Name + same-day fallback for unmatched Strava activities
    # Handles DEVELOPMENT uploads where FIT timezone causes large offset
    _DAY_SECONDS = 86400
    for sa in strava:
        if sa["strava_id"] in matched_strava_ids:
            continue
        if not sa["name"]:
            continue

        strava_epoch = sa["start_epoch"]
        best_match = None

        for src in all_sources:
            if src["name"] != sa["name"]:
                continue
            # Same name — check if within ±24 hours (timezone offset can be up to ~12h)
            diff = abs(src["start_epoch"] - strava_epoch)
            if diff <= _DAY_SECONDS:
                best_match = src
                break  # name + day match is strong enough

        if best_match is None:
            continue

        key = (best_match["platform"], best_match["source_id"], "strava")
        if key in existing:
            matched_strava_ids.add(sa["strava_id"])
            continue

        with get_connection() as conn:
            log_activity_sync(
                conn,
                source_platform=best_match["platform"],
                source_id=best_match["source_id"],
                destination="strava",
                destination_id=sa["strava_id"],
                status="external",
            )

        existing.add(key)
        matched_strava_ids.add(sa["strava_id"])
        reconciled += 1
        logger.debug(
            "Reconciled (name+day): %s:%s → strava:%s (name=%s)",
            best_match["platform"], best_match["source_id"],
            sa["strava_id"], sa["name"],
        )

    logger.info("Reconciled %d Strava activities.", reconciled)
    return reconciled


def main():
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    print("=== Strava Activity Reconciliation ===")
    count = reconcile_strava_syncs()
    print(f"\nReconciled: {count} activities marked as 'external'")
    sys.exit(0)


if __name__ == "__main__":
    main()
