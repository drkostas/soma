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


def _load_tokens_from_db():
    """Load cached Garmin OAuth tokens from the database."""
    try:
        from db import get_connection
        import json
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT credentials FROM platform_credentials WHERE platform = 'garmin_tokens' LIMIT 1")
                row = cur.fetchone()
                if row and row[0]:
                    tokens = row[0] if isinstance(row[0], dict) else json.loads(row[0])
                    # Write tokens to filesystem so garth can load them
                    GARMINTOKENS.mkdir(parents=True, exist_ok=True)
                    for filename, data in tokens.items():
                        (GARMINTOKENS / filename).write_text(json.dumps(data) if isinstance(data, dict) else data)
                    return True
    except Exception as e:
        print(f"Could not load tokens from DB: {e}")
    return False


def _save_tokens_to_db():
    """Save Garmin OAuth tokens to the database for persistence across CI runs."""
    try:
        from db import get_connection
        import json
        tokens = {}
        for f in GARMINTOKENS.iterdir():
            if f.is_file():
                try:
                    tokens[f.name] = json.loads(f.read_text())
                except json.JSONDecodeError:
                    tokens[f.name] = f.read_text()
        if tokens:
            with get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("""
                        INSERT INTO platform_credentials (platform, credentials, status)
                        VALUES ('garmin_tokens', %s, 'active')
                        ON CONFLICT (platform) DO UPDATE SET credentials = EXCLUDED.credentials, updated_at = NOW()
                    """, (json.dumps(tokens),))
                conn.commit()
    except Exception as e:
        print(f"Could not save tokens to DB: {e}")


def init_garmin() -> Garmin:
    """Initialize Garmin client, reusing cached tokens when possible."""
    # Attempt 1: Load from DB-cached tokens (survives CI ephemeral runners)
    _load_tokens_from_db()

    # Attempt 2: Load from filesystem cached tokens
    try:
        client = Garmin()
        client.login(str(GARMINTOKENS))
        # Save back to DB in case they were refreshed
        GARMINTOKENS.mkdir(parents=True, exist_ok=True)
        client.garth.dump(str(GARMINTOKENS))
        _save_tokens_to_db()
        return client
    except (FileNotFoundError, GarthHTTPError, GarminConnectAuthenticationError):
        pass

    # Attempt 3: Fresh login with credentials
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

    # Persist tokens to filesystem and DB
    GARMINTOKENS.mkdir(parents=True, exist_ok=True)
    client.garth.dump(str(GARMINTOKENS))
    _save_tokens_to_db()

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
