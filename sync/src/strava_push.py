"""Push enriched Hevy workouts to Strava as FIT uploads."""

from __future__ import annotations

import logging
import os
import tempfile
import time

from db import get_connection, log_activity_sync
from fit_generator import generate_fit

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
_MAX_UPLOAD_POLLS = 5
_POLL_INTERVAL_S = 3


def push_workout_to_strava(
    client,
    workout: dict,
    hr_samples: list[int] | None,
    rule_id: int | None = None,
) -> dict:
    """Generate a FIT file from a Hevy workout and upload it to Strava.

    Parameters
    ----------
    client:
        A StravaClient instance (or compatible mock).
    workout:
        Enriched workout dict with keys: hevy_id, hevy_title, hevy_workout, date.
    hr_samples:
        Heart-rate samples to embed in the FIT file, or None.
    rule_id:
        Optional sync rule ID for logging.

    Returns
    -------
    dict with keys:
        status: 'sent' or 'error'
        strava_activity_id: int or None
        error: str or None
    """
    hevy_id = workout["hevy_id"]
    title = workout["hevy_title"]
    hevy_workout = workout["hevy_workout"]

    fit_path = None
    try:
        # 1. Generate FIT file in a temp directory
        tmp_dir = tempfile.mkdtemp(prefix="strava_push_")
        fit_path = os.path.join(tmp_dir, f"{hevy_id}.fit")

        logger.info("Generating FIT file for workout %s at %s", hevy_id, fit_path)
        generate_fit(
            hevy_workout=hevy_workout,
            hr_samples=hr_samples,
            output_path=fit_path,
        )

        # 2. Upload to Strava
        logger.info("Uploading FIT file for workout %s to Strava", hevy_id)
        upload_result = client.upload_activity(
            fit_path=fit_path,
            name=title,
            sport_type="WeightTraining",
        )

        upload_id = upload_result["id"]
        activity_id = upload_result.get("activity_id")
        error = None

        # 3. Poll for activity_id if not immediately available
        if not activity_id:
            for poll in range(_MAX_UPLOAD_POLLS):
                time.sleep(_POLL_INTERVAL_S)
                status_result = client.check_upload_status(upload_id)

                activity_id = status_result.get("activity_id")
                error = status_result.get("error")

                if activity_id or error:
                    break
            else:
                # Exhausted all polls without activity_id or error
                if not activity_id and not error:
                    error = f"Upload polling timed out after {_MAX_UPLOAD_POLLS} attempts"

        # 4. Determine final status
        if error:
            status = "error"
            activity_id = None
        else:
            status = "sent"

        # 5. Log the sync
        with get_connection() as conn:
            log_activity_sync(
                conn,
                source_platform="hevy",
                source_id=hevy_id,
                destination="strava",
                destination_id=str(activity_id) if activity_id else None,
                rule_id=rule_id,
                status=status,
                error_message=error,
            )

        return {
            "status": status,
            "strava_activity_id": activity_id,
            "error": error,
        }

    except Exception as exc:
        logger.exception("Failed to push workout %s to Strava", hevy_id)
        error_msg = str(exc)

        # Log the error
        try:
            with get_connection() as conn:
                log_activity_sync(
                    conn,
                    source_platform="hevy",
                    source_id=hevy_id,
                    destination="strava",
                    destination_id=None,
                    rule_id=rule_id,
                    status="error",
                    error_message=error_msg,
                )
        except Exception:
            logger.exception("Failed to log sync error for workout %s", hevy_id)

        return {
            "status": "error",
            "strava_activity_id": None,
            "error": error_msg,
        }

    finally:
        # 6. Clean up temp FIT files
        if fit_path and os.path.exists(fit_path):
            try:
                os.remove(fit_path)
                os.rmdir(os.path.dirname(fit_path))
            except OSError:
                logger.warning("Failed to clean up temp FIT file: %s", fit_path)
