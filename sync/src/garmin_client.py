"""Garmin Connect API client wrapper — backed by garmin-auth package.

Public API (unchanged — all existing imports continue to work):
    init_garmin() -> Garmin client
    rate_limited_call(func, *args, **kwargs) -> result
    set_activity_description(client, activity_id, description)
    upload_activity_image(client, activity_id, image_bytes, filename)
    API_CALL_DELAY
"""

import io
import os
import time

from garminconnect import Garmin

from garmin_auth import GarminAuth, rate_limited_call as _ga_rate_limited_call
from garmin_auth.storage import DBTokenStore, FileTokenStore

from config import GARMINTOKENS, DATABASE_URL, get_garmin_credentials

# Delay between API calls to avoid rate limiting (seconds)
API_CALL_DELAY = 1.0


def init_garmin() -> Garmin:
    """Initialize Garmin client, reusing cached tokens when possible.

    Uses garmin-auth package with dual storage (file + DB) for token persistence.
    """
    email, password = get_garmin_credentials()

    # Use DB as primary store (survives CI ephemeral runners),
    # /tmp for garth token files on read-only filesystems (Vercel, GitHub Actions)
    store = DBTokenStore(DATABASE_URL)
    garth_dir = "/tmp/.garminconnect" if not os.path.isdir(GARMINTOKENS) else GARMINTOKENS

    auth = GarminAuth(
        email=email,
        password=password,
        store=store,
        token_dir=garth_dir,
    )

    client = auth.login()

    # Also save to DB after successful login (garmin-auth saves to its store,
    # but we want to ensure both file and DB are in sync)
    try:
        file_store = FileTokenStore(GARMINTOKENS)
        tokens = file_store.load()
        if tokens:
            store.save(tokens)
    except Exception:
        pass

    return client


def rate_limited_call(func, *args, **kwargs):
    """Call a Garmin API method with rate limiting and retry on 429."""
    return _ga_rate_limited_call(func, *args, delay=API_CALL_DELAY, **kwargs)


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
