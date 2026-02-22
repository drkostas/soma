"""Configuration loaded from environment variables."""

import os
from pathlib import Path

from dotenv import load_dotenv

# Load .env from project root
load_dotenv(Path(__file__).resolve().parents[2] / ".env")

DATABASE_URL = os.environ["DATABASE_URL"]
GARMIN_EMAIL = os.environ.get("GARMIN_EMAIL", "")
GARMIN_PASSWORD = os.environ.get("GARMIN_PASSWORD", "")
GARMINTOKENS = Path(
    os.environ.get("GARMINTOKENS", "~/.garminconnect")
).expanduser()
HEVY_API_KEY = os.environ.get("HEVY_API_KEY", "")
HEVY_BASE_URL = "https://api.hevyapp.com/v1"

# Strava OAuth2
STRAVA_CLIENT_ID = os.environ.get("STRAVA_CLIENT_ID", "")
STRAVA_CLIENT_SECRET = os.environ.get("STRAVA_CLIENT_SECRET", "")
STRAVA_BASE_URL = "https://www.strava.com/api/v3"
