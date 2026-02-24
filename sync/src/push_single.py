"""Push a single activity to a destination.

Usage:
    python -m src.push_single <source_platform> <source_id> <destination>

Examples:
    python -m src.push_single garmin 12345678 strava
    python -m src.push_single hevy abc123 strava
"""

from __future__ import annotations

import json
import sys

from db import get_connection, get_platform_credentials
from strava_client import StravaClient


def _init_strava() -> StravaClient:
    """Load Strava credentials and return an authenticated client."""
    with get_connection() as conn:
        creds = get_platform_credentials(conn, "strava")

    if not creds or creds["status"] != "active":
        raise RuntimeError("Strava not connected or credentials inactive")

    tokens = creds["credentials"]
    client = StravaClient(
        access_token=tokens["access_token"],
        refresh_token=tokens["refresh_token"],
    )

    # Refresh token
    from datetime import datetime, timezone
    from db import upsert_platform_credentials
    new_tokens = client.refresh_tokens()
    # Convert epoch int to datetime for timestamptz column
    expires_epoch = new_tokens.get("expires_at")
    expires_dt = (
        datetime.fromtimestamp(expires_epoch, tz=timezone.utc)
        if expires_epoch else None
    )
    with get_connection() as conn:
        upsert_platform_credentials(
            conn, "strava", "oauth2",
            {**tokens, "access_token": new_tokens["access_token"],
             "refresh_token": new_tokens["refresh_token"]},
            expires_at=expires_dt,
        )

    return client


def push_single(source_platform: str, source_id: str, destination: str) -> dict:
    """Push a single activity from source to destination."""
    if destination != "strava":
        return {"status": "error", "error": f"Unsupported destination: {destination}"}

    client = _init_strava()

    if source_platform == "garmin":
        from garmin_push import push_garmin_activity_to_strava
        return push_garmin_activity_to_strava(client, int(source_id), garmin_client=None)

    elif source_platform == "hevy":
        from strava_push import push_workout_to_strava
        # Load workout data from DB
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT we.hevy_id, we.hevy_title, h.raw_json, we.hr_samples
                    FROM workout_enrichment we
                    JOIN hevy_raw_data h ON h.hevy_id = we.hevy_id AND h.endpoint_name = 'workout'
                    WHERE we.hevy_id = %s
                """, (source_id,))
                row = cur.fetchone()

        if not row:
            return {"status": "error", "error": f"Hevy workout {source_id} not found"}

        hevy_id, hevy_title, raw_json, hr_samples = row
        if isinstance(raw_json, str):
            raw_json = json.loads(raw_json)

        workout = {
            "hevy_id": hevy_id,
            "hevy_title": hevy_title,
            "hevy_workout": raw_json,
        }
        return push_workout_to_strava(client, workout, hr_samples)

    else:
        return {"status": "error", "error": f"Unsupported source: {source_platform}"}


def main():
    if len(sys.argv) != 4:
        print("Usage: python -m src.push_single <source_platform> <source_id> <destination>")
        sys.exit(1)

    source_platform, source_id, destination = sys.argv[1], sys.argv[2], sys.argv[3]
    result = push_single(source_platform, source_id, destination)
    print(json.dumps(result))
    sys.exit(0 if result["status"] == "sent" else 1)


if __name__ == "__main__":
    main()
