import pytest
from unittest.mock import patch, MagicMock, call
from datetime import datetime


def _mock_conn():
    conn = MagicMock()
    cur = MagicMock()
    conn.cursor.return_value.__enter__ = MagicMock(return_value=cur)
    conn.cursor.return_value.__exit__ = MagicMock(return_value=False)
    return conn, cur


@patch("strava_sync.upsert_strava_raw")
@patch("strava_sync.get_connection")
def test_sync_recent_activities(mock_get_conn, mock_upsert):
    from strava_sync import sync_recent_activities
    conn, cur = _mock_conn()
    mock_get_conn.return_value.__enter__ = MagicMock(return_value=conn)
    mock_get_conn.return_value.__exit__ = MagicMock(return_value=False)

    mock_client = MagicMock()
    mock_client.get_activities.return_value = [
        {"id": 100, "name": "Morning Run", "sport_type": "Run"},
        {"id": 101, "name": "Evening Ride", "sport_type": "Ride"},
    ]

    count = sync_recent_activities(mock_client, page_size=30)
    assert count == 2
    assert mock_upsert.call_count == 2
    mock_upsert.assert_any_call(conn, 100, "activity", {"id": 100, "name": "Morning Run", "sport_type": "Run"})
    mock_upsert.assert_any_call(conn, 101, "activity", {"id": 101, "name": "Evening Ride", "sport_type": "Ride"})


@patch("strava_sync.upsert_strava_raw")
@patch("strava_sync.get_connection")
def test_sync_activity_details(mock_get_conn, mock_upsert):
    from strava_sync import sync_activity_details
    conn, cur = _mock_conn()
    mock_get_conn.return_value.__enter__ = MagicMock(return_value=conn)
    mock_get_conn.return_value.__exit__ = MagicMock(return_value=False)

    mock_client = MagicMock()
    mock_client.get_activity.return_value = {"id": 100, "calories": 500, "description": "Great run"}
    mock_client.get_activity_streams.return_value = [
        {"type": "heartrate", "data": [120, 130]},
    ]

    sync_activity_details(mock_client, 100)
    assert mock_upsert.call_count == 2  # detail + streams
    mock_upsert.assert_any_call(conn, 100, "detail", {"id": 100, "calories": 500, "description": "Great run"})


@patch("strava_sync.upsert_strava_raw")
@patch("strava_sync.get_connection")
def test_sync_paginates(mock_get_conn, mock_upsert):
    from strava_sync import sync_recent_activities
    conn, cur = _mock_conn()
    mock_get_conn.return_value.__enter__ = MagicMock(return_value=conn)
    mock_get_conn.return_value.__exit__ = MagicMock(return_value=False)

    mock_client = MagicMock()
    mock_client.get_activities.side_effect = [
        [{"id": i, "name": f"Act {i}", "sport_type": "Run"} for i in range(30)],
        [{"id": 30, "name": "Act 30", "sport_type": "Run"}],
    ]

    count = sync_recent_activities(mock_client, page_size=30)
    assert count == 31
    assert mock_client.get_activities.call_count == 2
