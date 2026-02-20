"""Test new DB helper functions with mocked connections."""

from unittest.mock import MagicMock, patch, call
from db import upsert_hevy_raw, upsert_activity_raw, upsert_profile_raw, get_backfill_progress, update_backfill_progress


def test_upsert_hevy_raw_executes_correct_sql():
    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_conn.cursor.return_value.__enter__ = MagicMock(return_value=mock_cur)
    mock_conn.cursor.return_value.__exit__ = MagicMock(return_value=False)

    upsert_hevy_raw(mock_conn, "wk_abc123", "workout", {"title": "Push Day"})
    mock_cur.execute.assert_called_once()
    sql = mock_cur.execute.call_args[0][0]
    assert "hevy_raw_data" in sql
    assert "ON CONFLICT" in sql


def test_upsert_activity_raw_executes_correct_sql():
    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_conn.cursor.return_value.__enter__ = MagicMock(return_value=mock_cur)
    mock_conn.cursor.return_value.__exit__ = MagicMock(return_value=False)

    upsert_activity_raw(mock_conn, 12345678, "details", {"activityType": "running"})
    mock_cur.execute.assert_called_once()
    sql = mock_cur.execute.call_args[0][0]
    assert "garmin_activity_raw" in sql
    assert "ON CONFLICT" in sql


def test_upsert_profile_raw_executes_correct_sql():
    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_conn.cursor.return_value.__enter__ = MagicMock(return_value=mock_cur)
    mock_conn.cursor.return_value.__exit__ = MagicMock(return_value=False)

    upsert_profile_raw(mock_conn, "devices", [{"deviceId": 123}])
    mock_cur.execute.assert_called_once()
    sql = mock_cur.execute.call_args[0][0]
    assert "garmin_profile_raw" in sql
    assert "ON CONFLICT" in sql


def test_get_backfill_progress_returns_none_for_missing():
    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_conn.cursor.return_value.__enter__ = MagicMock(return_value=mock_cur)
    mock_conn.cursor.return_value.__exit__ = MagicMock(return_value=False)
    mock_cur.fetchone.return_value = None

    result = get_backfill_progress(mock_conn, "garmin_daily")
    assert result is None


def test_update_backfill_progress_executes_upsert():
    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_conn.cursor.return_value.__enter__ = MagicMock(return_value=mock_cur)
    mock_conn.cursor.return_value.__exit__ = MagicMock(return_value=False)

    update_backfill_progress(mock_conn, "hevy", last_page=5, items_completed=50, status="running")
    mock_cur.execute.assert_called_once()
    sql = mock_cur.execute.call_args[0][0]
    assert "backfill_progress" in sql
    assert "ON CONFLICT" in sql
