"""Strava API v3 client with OAuth2 token management."""

import time

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from config import STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_BASE_URL

# Delay between API calls (seconds)
API_CALL_DELAY = 0.5


class StravaClient:
    """Strava API client with OAuth2 token refresh and rate limiting."""

    def __init__(self, access_token=None, refresh_token=None,
                 client_id=None, client_secret=None, base_url=None):
        self.access_token = access_token or ""
        self.refresh_token = refresh_token or ""
        self.client_id = client_id or STRAVA_CLIENT_ID
        self.client_secret = client_secret or STRAVA_CLIENT_SECRET
        self.base_url = (base_url or STRAVA_BASE_URL).rstrip("/")
        self.expires_at = 0

        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"Bearer {self.access_token}",
            "Accept": "application/json",
        })
        # Auto-retry on transient server errors
        retry = Retry(
            total=3,
            backoff_factor=2,
            status_forcelist=[500, 502, 503, 504],
            allowed_methods=["GET", "POST"],
            raise_on_status=False,
        )
        self.session.mount("https://", HTTPAdapter(max_retries=retry))

    def _update_auth_header(self):
        """Update session Authorization header after token refresh."""
        self.session.headers["Authorization"] = f"Bearer {self.access_token}"

    def refresh_tokens(self):
        """Refresh OAuth2 access token using refresh token."""
        resp = requests.post(
            "https://www.strava.com/api/v3/oauth/token",
            data={
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "grant_type": "refresh_token",
                "refresh_token": self.refresh_token,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        self.access_token = data["access_token"]
        self.refresh_token = data["refresh_token"]
        self.expires_at = data.get("expires_at", 0)
        self._update_auth_header()
        return data

    def ensure_token_fresh(self):
        """Refresh token if it expires within 10 minutes."""
        if self.expires_at and time.time() > (self.expires_at - 600):
            print("Strava token expiring soon, refreshing...")
            self.refresh_tokens()

    def _get(self, path, params=None):
        """Rate-limited GET request."""
        self.ensure_token_fresh()
        url = f"{self.base_url}{path}"
        resp = self.session.get(url, params=params, timeout=30)
        if resp.status_code == 429:
            wait = int(resp.headers.get("Retry-After", 60))
            print(f"Strava rate limited. Waiting {wait}s...")
            time.sleep(wait)
            resp = self.session.get(url, params=params, timeout=30)
        resp.raise_for_status()
        time.sleep(API_CALL_DELAY)
        return resp.json()

    def get_athlete(self):
        """Get the authenticated athlete profile."""
        return self._get("/athlete")

    def get_activities(self, after=None, before=None, page=1, per_page=30):
        """Get a page of athlete activities."""
        params = {"page": page, "per_page": per_page}
        if after:
            params["after"] = after
        if before:
            params["before"] = before
        return self._get("/athlete/activities", params=params)

    def get_activity(self, activity_id):
        """Get detailed information for a single activity."""
        return self._get(f"/activities/{activity_id}")

    def get_activity_streams(self, activity_id, keys=None):
        """Get data streams for an activity."""
        if keys is None:
            keys = ["time", "heartrate", "latlng", "altitude", "velocity_smooth"]
        return self._get(
            f"/activities/{activity_id}/streams",
            params={"keys": ",".join(keys), "key_type": "time"},
        )

    def upload_activity(self, fit_path, name=None, sport_type=None, description=None):
        """Upload a FIT file as a new activity."""
        self.ensure_token_fresh()
        url = f"{self.base_url}/uploads"
        data = {"data_type": "fit"}
        if name:
            data["name"] = name
        if sport_type:
            data["sport_type"] = sport_type
        if description:
            data["description"] = description
        with open(fit_path, "rb") as f:
            resp = self.session.post(url, data=data, files={"file": f}, timeout=60)
        resp.raise_for_status()
        time.sleep(API_CALL_DELAY)
        return resp.json()

    def check_upload_status(self, upload_id):
        """Check the processing status of an upload."""
        return self._get(f"/uploads/{upload_id}")
