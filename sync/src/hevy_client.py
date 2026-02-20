"""Hevy API v1 client with retry and rate limiting."""

import time

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from config import HEVY_API_KEY, HEVY_BASE_URL

# Delay between API calls (seconds)
API_CALL_DELAY = 0.5


class HevyClient:
    """HTTP client for the Hevy API v1."""

    def __init__(self, api_key: str = None, base_url: str = None):
        self.base_url = (base_url or HEVY_BASE_URL).rstrip("/")
        self.session = requests.Session()
        self.session.headers.update({
            "api-key": api_key or HEVY_API_KEY,
            "Accept": "application/json",
        })
        # Auto-retry on connection errors, 429, 500, 502, 503, 504
        retry = Retry(
            total=5,
            backoff_factor=2,
            status_forcelist=[429, 500, 502, 503, 504],
            allowed_methods=["GET"],
            raise_on_status=False,
        )
        self.session.mount("https://", HTTPAdapter(max_retries=retry))

    def _get(self, path: str, params: dict = None) -> dict:
        """Make a GET request with rate limiting."""
        url = f"{self.base_url}{path}"
        resp = self.session.get(url, params=params, timeout=30)
        resp.raise_for_status()
        time.sleep(API_CALL_DELAY)
        return resp.json()

    def get_workout_count(self) -> int:
        """Get total number of workouts."""
        data = self._get("/workouts/count")
        return data["workout_count"]

    def get_workouts(self, page: int = 1, page_size: int = 10) -> dict:
        """Get a page of workouts."""
        return self._get("/workouts", {"page": page, "pageSize": page_size})

    def get_exercise_templates(self, page: int = 1, page_size: int = 10) -> dict:
        """Get a page of exercise templates."""
        return self._get("/exercise_templates", {"page": page, "pageSize": page_size})

    def get_routines(self, page: int = 1, page_size: int = 10) -> dict:
        """Get a page of routines."""
        return self._get("/routines", {"page": page, "pageSize": page_size})

    def get_routine_folders(self, page: int = 1, page_size: int = 10) -> dict:
        """Get a page of routine folders."""
        return self._get("/routine_folders", {"page": page, "pageSize": page_size})

    def get_workout_events(self, since: str, page: int = 1, page_size: int = 10) -> dict:
        """Get workout events since a timestamp (ISO 8601) for incremental sync."""
        return self._get(
            "/workouts/events",
            {"since": since, "page": page, "pageSize": page_size},
        )
