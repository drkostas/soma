"""Garmin Connect API client wrapper with token caching."""

import time
from pathlib import Path

from garminconnect import (
    Garmin,
    GarminConnectAuthenticationError,
    GarminConnectTooManyRequestsError,
)
from garth.exc import GarthHTTPError

from config import GARMIN_EMAIL, GARMIN_PASSWORD, GARMINTOKENS

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
    if not GARMIN_EMAIL or not GARMIN_PASSWORD:
        raise RuntimeError(
            "No cached tokens and GARMIN_EMAIL/GARMIN_PASSWORD not set. "
            "Cannot authenticate with Garmin Connect."
        )

    client = Garmin(email=GARMIN_EMAIL, password=GARMIN_PASSWORD)
    client.login()

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
