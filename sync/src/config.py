"""Configuration loaded from environment variables, with DB credential fallback."""

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

# Telegram notifications (env var defaults, overridden by DB at runtime)
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "")


def _get_db_credentials(platform: str) -> dict | None:
    """Read credentials from platform_credentials table. Returns None on failure."""
    try:
        import psycopg2
        import json
        conn = psycopg2.connect(DATABASE_URL)
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT credentials FROM platform_credentials WHERE platform = %s AND status = 'active'",
                    (platform,),
                )
                row = cur.fetchone()
                if not row:
                    return None
                creds = row[0]
                if isinstance(creds, str):
                    creds = json.loads(creds)
                return creds
        finally:
            conn.close()
    except Exception:
        return None


def get_hevy_api_key() -> str:
    """Get Hevy API key: DB first, then env var."""
    db_creds = _get_db_credentials("hevy")
    if db_creds and db_creds.get("api_key"):
        return db_creds["api_key"]
    return HEVY_API_KEY


def get_telegram_config() -> tuple[str, str]:
    """Get Telegram bot_token and chat_id: DB first, then env var."""
    db_creds = _get_db_credentials("telegram")
    if db_creds and db_creds.get("bot_token") and db_creds.get("chat_id"):
        return db_creds["bot_token"], db_creds["chat_id"]
    return TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID


def get_garmin_credentials() -> tuple[str, str]:
    """Get Garmin email and password: DB first, then env var."""
    db_creds = _get_db_credentials("garmin")
    if db_creds and db_creds.get("email") and db_creds.get("password"):
        return db_creds["email"], db_creds["password"]
    return GARMIN_EMAIL, GARMIN_PASSWORD
