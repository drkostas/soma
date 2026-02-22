import pytest
from unittest.mock import patch, MagicMock
import json


def _mock_conn():
    """Create a mock DB connection with cursor context manager."""
    conn = MagicMock()
    cur = MagicMock()
    conn.cursor.return_value.__enter__ = MagicMock(return_value=cur)
    conn.cursor.return_value.__exit__ = MagicMock(return_value=False)
    return conn, cur


def test_upsert_strava_raw():
    from db import upsert_strava_raw
    conn, cur = _mock_conn()
    upsert_strava_raw(conn, 12345, "activity", {"name": "Morning Run"})
    cur.execute.assert_called_once()
    sql = cur.execute.call_args[0][0]
    assert "strava_raw_data" in sql
    assert "ON CONFLICT" in sql


def test_upsert_platform_credentials():
    from db import upsert_platform_credentials
    conn, cur = _mock_conn()
    upsert_platform_credentials(conn, "strava", "oauth2", {"access_token": "abc"})
    cur.execute.assert_called_once()
    sql = cur.execute.call_args[0][0]
    assert "platform_credentials" in sql
    assert "ON CONFLICT" in sql


def test_get_platform_credentials():
    from db import get_platform_credentials
    conn, cur = _mock_conn()
    cur.fetchone.return_value = None
    result = get_platform_credentials(conn, "strava")
    assert result is None
    cur.execute.assert_called_once()


def test_get_sync_rules():
    from db import get_sync_rules
    conn, cur = _mock_conn()
    cur.fetchall.return_value = []
    result = get_sync_rules(conn, source_platform="strava")
    assert result == []


def test_log_activity_sync():
    from db import log_activity_sync
    conn, cur = _mock_conn()
    log_activity_sync(conn, "hevy", "abc123", "strava", rule_id=1, status="sent")
    cur.execute.assert_called_once()
    sql = cur.execute.call_args[0][0]
    assert "activity_sync_log" in sql


def test_was_already_synced():
    from db import was_already_synced
    conn, cur = _mock_conn()
    cur.fetchone.return_value = (1,)
    result = was_already_synced(conn, "hevy", "abc123", "strava")
    assert result is True

    cur.fetchone.return_value = (0,)
    result = was_already_synced(conn, "hevy", "abc123", "strava")
    assert result is False
