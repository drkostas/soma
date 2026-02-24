"""Push Garmin activities to Strava by downloading the original FIT file."""

from __future__ import annotations

import io
import logging
import os
import tempfile
import time
import zipfile

from garminconnect import Garmin

from db import get_connection, log_activity_sync
from garmin_client import init_garmin, rate_limited_call

logger = logging.getLogger(__name__)

# Garmin activityType.typeKey -> Strava sport_type
GARMIN_TO_STRAVA_SPORT = {
    "running": "Run",
    "trail_running": "TrailRun",
    "treadmill_running": "Run",
    "cycling": "Ride",
    "mountain_biking": "MountainBikeRide",
    "indoor_cycling": "Ride",
    "virtual_ride": "VirtualRide",
    "lap_swimming": "Swim",
    "open_water_swimming": "Swim",
    "strength_training": "WeightTraining",
    "walking": "Walk",
    "hiking": "Hike",
    "yoga": "Yoga",
    "elliptical": "Elliptical",
    "rowing": "Rowing",
    "skiing": "AlpineSki",
    "cross_country_skiing": "NordicSki",
    "snowboarding": "Snowboard",
    "surfing": "Surfing",
    "kitesurfing": "Kitesurf",
}


def _get_activity_summary(conn, activity_id: int) -> dict | None:
    """Fetch the summary JSON for a Garmin activity."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT raw_json FROM garmin_activity_raw
            WHERE activity_id = %s AND endpoint_name = 'summary'
            """,
            (activity_id,),
        )
        row = cur.fetchone()
        if not row:
            return None
        import json
        raw = row[0]
        if isinstance(raw, str):
            raw = json.loads(raw)
        return raw


def _download_fit_file(garmin_client, activity_id: int) -> str:
    """Download the original FIT file from Garmin Connect.

    Returns the path to the extracted FIT file on disk.
    The caller is responsible for cleaning up the temp directory.
    """
    logger.info("Downloading FIT file for Garmin activity %s", activity_id)
    zip_bytes = rate_limited_call(
        garmin_client.download_activity,
        str(activity_id),
        dl_fmt=Garmin.ActivityDownloadFormat.ORIGINAL,
    )

    # The ORIGINAL format returns a zip file containing the FIT
    tmp_dir = tempfile.mkdtemp(prefix="garmin_push_")

    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        fit_names = [n for n in zf.namelist() if n.endswith(".fit")]
        if not fit_names:
            raise ValueError(f"No .fit file found in zip for activity {activity_id}")
        fit_name = fit_names[0]
        zf.extract(fit_name, tmp_dir)
        return os.path.join(tmp_dir, fit_name)


def push_garmin_activity_to_strava(
    strava_client,
    activity_id: int,
    garmin_client=None,
    conn=None,
    rule_id: int | None = None,
) -> dict:
    """Download a Garmin activity's FIT file and upload it to Strava.

    This gives Strava the full activity data — GPS, HR, map, everything.

    Parameters
    ----------
    strava_client:
        A StravaClient instance for Strava API calls.
    activity_id:
        Garmin activity ID.
    garmin_client:
        A Garmin client instance. If None, will be initialized automatically.
    conn:
        Optional DB connection.
    rule_id:
        Optional sync rule ID for logging.

    Returns
    -------
    dict with keys: status, strava_activity_id, error
    """
    fit_path = None
    try:
        # 1. Load activity summary for metadata
        with get_connection() as db_conn:
            summary = _get_activity_summary(db_conn, activity_id)

        if not summary:
            error_msg = f"No summary found for activity {activity_id}"
            logger.error(error_msg)
            return {"status": "error", "strava_activity_id": None, "error": error_msg}

        name = summary.get("activityName") or "Garmin Activity"
        garmin_type = summary.get("activityType", {}).get("typeKey", "")
        sport_type = GARMIN_TO_STRAVA_SPORT.get(garmin_type, "Workout")

        # 2. Init Garmin client if not provided
        if garmin_client is None:
            garmin_client = init_garmin()

        # 3. Download the original FIT file from Garmin
        fit_path = _download_fit_file(garmin_client, activity_id)
        logger.info("FIT file downloaded: %s", fit_path)

        # 4. Upload to Strava
        logger.info(
            "Uploading Garmin activity %s to Strava: %s (%s)",
            activity_id, name, sport_type,
        )
        upload_result = strava_client.upload_activity(
            fit_path=fit_path,
            name=name,
            sport_type=sport_type,
        )

        upload_id = upload_result["id"]
        strava_activity_id = upload_result.get("activity_id")
        error = None

        # 5. Poll for activity_id if not immediately available
        if not strava_activity_id:
            for _ in range(5):
                time.sleep(3)
                status_result = strava_client.check_upload_status(upload_id)
                strava_activity_id = status_result.get("activity_id")
                error = status_result.get("error")
                if strava_activity_id or error:
                    break

        if error:
            status = "error"
            strava_activity_id = None
        else:
            status = "sent"

        # 6. Log the sync
        with get_connection() as db_conn:
            log_activity_sync(
                db_conn,
                source_platform="garmin",
                source_id=str(activity_id),
                destination="strava",
                destination_id=str(strava_activity_id) if strava_activity_id else None,
                rule_id=rule_id,
                status=status,
                error_message=error,
            )

        logger.info(
            "Garmin activity %s -> Strava activity %s (%s)",
            activity_id, strava_activity_id, status,
        )
        return {
            "status": status,
            "strava_activity_id": strava_activity_id,
            "error": error,
        }

    except Exception as exc:
        logger.exception("Failed to push Garmin activity %s to Strava", activity_id)
        error_msg = str(exc)

        try:
            with get_connection() as db_conn:
                log_activity_sync(
                    db_conn,
                    source_platform="garmin",
                    source_id=str(activity_id),
                    destination="strava",
                    destination_id=None,
                    rule_id=rule_id,
                    status="error",
                    error_message=error_msg,
                )
        except Exception:
            logger.exception("Failed to log sync error for activity %s", activity_id)

        return {
            "status": "error",
            "strava_activity_id": None,
            "error": error_msg,
        }

    finally:
        # Clean up temp FIT file
        if fit_path and os.path.exists(fit_path):
            try:
                os.remove(fit_path)
                os.rmdir(os.path.dirname(fit_path))
            except OSError:
                logger.warning("Failed to clean up temp FIT file: %s", fit_path)
