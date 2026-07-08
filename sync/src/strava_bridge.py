"""Garmin 'facterino' bridge → Strava.

soma pushes finalized activities to Strava WITHOUT Strava's (now paid) API by
uploading the final FIT to a dedicated Garmin account (facterino) that is
connected to Strava. Garmin's own outbound sync forwards any uploaded activity
to the connected Strava within minutes — a Garmin→Strava *direct integration*,
exempt from both the API paywall and the 2026 intermediary ban. The user's MAIN
Garmin account stays disconnected from Strava, so there are no duplicates and no
pre-edit timing problem; only finalized FITs go to facterino.

Auth: Garmin's programmatic login is dead (garth deprecated, "new logins will not
work"), so facterino's OAuth token bundle is minted ONCE from a real-browser SSO
ticket and stored in the DB (platform=garmin_facterino_bridge). garth reuses and
auto-refreshes it (~1yr refresh window); no login ever runs here.
"""

from __future__ import annotations

import json
import logging
import os

import garth
import psycopg2

from config import DATABASE_URL

logger = logging.getLogger("strava_bridge")

_PLATFORM = "garmin_facterino_bridge"
_UA = "GCM-iOS-5.7.2.1"


def _fetch_dump() -> str | None:
    conn = psycopg2.connect(DATABASE_URL)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT credentials->>'garth_dump' FROM platform_credentials "
                "WHERE platform = %s AND status = 'active'",
                (_PLATFORM,),
            )
            row = cur.fetchone()
    finally:
        conn.close()
    return row[0] if row and row[0] else None


def _store_dump(dump: str) -> None:
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE platform_credentials SET credentials = %s WHERE platform = %s",
                (json.dumps({"garth_dump": dump}), _PLATFORM),
            )
    finally:
        conn.close()


def is_configured() -> bool:
    return _fetch_dump() is not None


def _client() -> garth.Client:
    """garth client for facterino, from the stored token bundle. Refreshes the
    short-lived access token and writes the refreshed bundle back to the DB."""
    dump = _fetch_dump()
    if not dump:
        raise RuntimeError(
            f"Facterino bridge token missing (platform={_PLATFORM}). "
            "Run the one-time browser-ticket bootstrap to mint it."
        )
    c = garth.Client()
    c.loads(dump)
    c.sess.headers.update({"User-Agent": _UA})
    try:
        c.refresh_oauth2()
        _store_dump(c.dumps())
    except Exception as exc:  # noqa: BLE001
        logger.warning("facterino token refresh failed (using existing): %s", exc)
    return c


def upload_finalized_activity(fit_path: str) -> dict:
    """Upload a finalized FIT to facterino Garmin. Garmin auto-forwards it to the
    connected Strava within minutes. Returns garth's upload result (has the new
    Garmin activityId / uploadId)."""
    if not os.path.isfile(fit_path):
        raise FileNotFoundError(fit_path)
    c = _client()
    with open(fit_path, "rb") as fp:
        result = c.upload(fp)
    logger.info("Uploaded %s to facterino; Garmin will forward to Strava", os.path.basename(fit_path))
    return result


def delete_activity(activity_id: int) -> None:
    """Remove an activity from facterino Garmin (used to clean up test uploads)."""
    _client().connectapi(f"/activity-service/activity/{activity_id}", method="DELETE")
