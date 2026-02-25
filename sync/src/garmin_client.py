"""Garmin Connect API client wrapper with token caching."""

import io
import os
import time
from pathlib import Path

from garminconnect import (
    Garmin,
    GarminConnectAuthenticationError,
    GarminConnectTooManyRequestsError,
)
from garth.exc import GarthHTTPError

from config import GARMINTOKENS, get_garmin_credentials

# Delay between API calls to avoid rate limiting (seconds)
API_CALL_DELAY = 1.0


def init_garmin() -> Garmin:
    """Initialize Garmin client, reusing cached tokens when possible."""
    # Attempt 1: Load from cached tokens
    try:
        client = Garmin()
        client.login(str(GARMINTOKENS))
        return client
    except (FileNotFoundError, GarthHTTPError, GarminConnectAuthenticationError):
        pass

    # Attempt 2: Fresh login with credentials
    email, password = get_garmin_credentials()
    if not email or not password:
        raise RuntimeError(
            "No cached tokens and Garmin credentials not set. "
            "Configure via Sync Hub settings or GARMIN_EMAIL/GARMIN_PASSWORD env vars."
        )

    # Temporarily unset GARMINTOKENS so login() doesn't try to load from it
    saved = os.environ.pop("GARMINTOKENS", None)
    try:
        client = Garmin(email=email, password=password)
        client.login()
    finally:
        if saved is not None:
            os.environ["GARMINTOKENS"] = saved

    # Persist tokens
    GARMINTOKENS.mkdir(parents=True, exist_ok=True)
    client.garth.dump(str(GARMINTOKENS))

    return client


def rate_limited_call(func, *args, **kwargs):
    """Call a Garmin API method with rate limiting and retry on 429."""
    max_retries = 3
    for attempt in range(max_retries):
        try:
            result = func(*args, **kwargs)
            time.sleep(API_CALL_DELAY)
            return result
        except GarminConnectTooManyRequestsError:
            wait = (attempt + 1) * 30
            print(f"Rate limited. Waiting {wait}s before retry...")
            time.sleep(wait)
    raise GarminConnectTooManyRequestsError("Max retries exceeded")


def set_activity_description(client: Garmin, activity_id: int, description: str):
    """Set description for a Garmin activity (not built into garminconnect lib)."""
    url = f"/activity-service/activity/{activity_id}"
    payload = {"activityId": activity_id, "description": description}
    result = client.garth.put("connectapi", url, json=payload, api=True)
    time.sleep(API_CALL_DELAY)
    return result


def upload_activity_image(client: Garmin, activity_id: int, image_bytes: bytes, filename: str = "image.png"):
    """Upload an image to a Garmin activity.

    Uses the undocumented Garmin Connect image upload endpoint:
    POST /activity-service/activity/{id}/image (multipart/form-data)
    """
    files = {"file": (filename, io.BytesIO(image_bytes))}
    result = client.garth.post(
        "connectapi",
        f"activity-service/activity/{activity_id}/image",
        files=files,
        api=True,
    )
    time.sleep(API_CALL_DELAY)
    return result
