"""Garmin Connect API client wrapper — backed by garmin-auth + CF Worker auth broker.

Public API (unchanged — all existing imports continue to work):
    init_garmin() -> Garmin client
    rate_limited_call(func, *args, **kwargs) -> result
    set_activity_description(client, activity_id, description)
    upload_activity_image(client, activity_id, image_bytes, filename)
    API_CALL_DELAY
"""

import io
import json
import logging
import os
import time
import urllib.request
import urllib.error

from garminconnect import Garmin

from garmin_auth import GarminAuth, rate_limited_call as _ga_rate_limited_call
from garmin_auth.storage import DBTokenStore, FileTokenStore

from config import GARMINTOKENS, DATABASE_URL, get_garmin_credentials

logger = logging.getLogger("garmin_client")

# Delay between API calls to avoid rate limiting (seconds)
API_CALL_DELAY = 1.0

# The Cloudflare Worker that handles Garmin login from a non-blocked IP.
# Same worker hevy2garmin's setup wizard uses. Shared across the soma
# ecosystem so any component can authenticate without being blocked by
# Garmin's cloud-IP detection on sso.garmin.com.
CF_WORKER_LOGIN_URL = os.environ.get(
    "GARMIN_CF_WORKER_URL",
    "https://hevy2garmin-exchange-di.gkos.workers.dev/login",
)
CF_WORKER_MFA_URL = os.environ.get(
    "GARMIN_CF_WORKER_MFA_URL",
    "https://hevy2garmin-exchange-di.gkos.workers.dev/login-mfa",
)


def init_garmin() -> Garmin:
    """Initialize Garmin client, reusing cached tokens when possible.

    Strategy:
        1. Load cached DI tokens from the DB (via garmin-auth DBTokenStore).
           If the tokens are valid (or auto-refresh succeeds), return immediately.
        2. If no cached tokens (first run, or legacy format rejected), authenticate
           via the Cloudflare Worker broker instead of calling Garmin directly.
           GitHub Actions / Vercel IPs are blocked by Garmin's Cloudflare; the
           Worker runs from Cloudflare's edge which Garmin accepts.
        3. Store the resulting DI tokens in the DB for future runs.
    """
    email, password = get_garmin_credentials()
    store = DBTokenStore(DATABASE_URL)
    token_dir = "/tmp/.garminconnect" if not os.path.isdir(GARMINTOKENS) else GARMINTOKENS

    # Strategy 1: try cached tokens (garmin-auth handles DI refresh internally)
    auth = GarminAuth(
        email=email,
        password=password,
        store=store,
        token_dir=token_dir,
    )
    try:
        client = auth.login()
        # If we got here without an exception, cached tokens worked.
        _persist_tokens(auth, store)
        return client
    except Exception as e:
        logger.info("Cached token login failed (%s), trying CF Worker auth broker", e)

    # Strategy 2: authenticate via the Cloudflare Worker
    tokens = _login_via_cf_worker(email, password)
    store.save(tokens)
    logger.info("Fresh DI tokens obtained via CF Worker and saved to DB")

    # Now load through garmin-auth so we get a proper Garmin client
    auth2 = GarminAuth(store=store, token_dir=token_dir)
    client = auth2.login()
    _persist_tokens(auth2, store)
    return client


def _login_via_cf_worker(email: str, password: str) -> dict:
    """Call the hevy2garmin Cloudflare Worker to authenticate with Garmin.

    The Worker runs on Cloudflare's edge network which Garmin does not block.
    It POSTs credentials to Garmin's portal/mobile login API and returns
    DI OAuth tokens.

    Raises RuntimeError if the Worker returns an error or MFA is required
    (MFA can't be handled in a non-interactive pipeline — the user needs
    to re-authenticate via the hevy2garmin dashboard instead).
    """
    body = json.dumps({"email": email, "password": password}).encode()
    req = urllib.request.Request(
        CF_WORKER_LOGIN_URL,
        data=body,
        headers={
            "Content-Type": "application/json",
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/131.0.0.0 Safari/537.36"
            ),
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        raise RuntimeError(
            f"CF Worker login failed (HTTP {e.code}): {e.read().decode()[:300]}"
        ) from e

    status = data.get("status")

    if status == "success":
        return {
            "di_token": data["di_token"],
            "di_refresh_token": data["di_refresh_token"],
            "di_client_id": data["di_client_id"],
        }

    if status == "needs_mfa":
        raise RuntimeError(
            "Garmin account has MFA enabled. The sync pipeline can't handle "
            "MFA codes non-interactively. Please re-authenticate via the "
            "hevy2garmin dashboard (which has an inline MFA code input), "
            "then the tokens will be shared with soma via the database."
        )

    if status == "invalid_credentials":
        raise RuntimeError(
            "Garmin login failed: invalid email or password. "
            "Check GARMIN_EMAIL and GARMIN_PASSWORD in your GitHub secrets."
        )

    if status == "rate_limited":
        raise RuntimeError(
            "Garmin rate-limited the login. Wait 30-60 minutes and retry. "
            "The sync circuit breaker will auto-resume on the next successful run."
        )

    raise RuntimeError(
        f"CF Worker login returned unexpected status: {data}"
    )


def _persist_tokens(auth: GarminAuth, store: DBTokenStore) -> None:
    """Save the current tokens back to the DB store."""
    try:
        tokens = auth._client.client.dumps() if auth._client else None
        if tokens:
            store.save(tokens)
    except Exception:
        pass


def rate_limited_call(func, *args, **kwargs):
    """Call a Garmin API method with rate limiting and retry on 429."""
    return _ga_rate_limited_call(func, *args, delay=API_CALL_DELAY, **kwargs)


def set_activity_description(client: Garmin, activity_id: int, description: str):
    """Set description for a Garmin activity (not built into garminconnect lib)."""
    url = f"/activity-service/activity/{activity_id}"
    payload = {"activityId": activity_id, "description": description}
    result = client.client.put("connectapi", url, json=payload, api=True)
    time.sleep(API_CALL_DELAY)
    return result


def upload_activity_image(client: Garmin, activity_id: int, image_bytes: bytes, filename: str = "image.png"):
    """Upload an image to a Garmin activity.

    Uses the undocumented Garmin Connect image upload endpoint:
    POST /activity-service/activity/{id}/image (multipart/form-data)
    """
    files = {"file": (filename, io.BytesIO(image_bytes))}
    result = client.client.post(
        "connectapi",
        f"activity-service/activity/{activity_id}/image",
        files=files,
        api=True,
    )
    time.sleep(API_CALL_DELAY)
    return result
