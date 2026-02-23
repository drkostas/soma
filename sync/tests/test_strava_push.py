"""Tests for Strava push connector."""

import os
import tempfile
from unittest.mock import patch, MagicMock, call

import pytest


SAMPLE_WORKOUT = {
    "hevy_id": "abc-123",
    "hevy_title": "Pull Day",
    "hevy_workout": {
        "id": "abc-123",
        "title": "Pull Day",
        "start_time": "2026-02-20T10:00:00Z",
        "end_time": "2026-02-20T11:00:00Z",
        "exercises": [
            {
                "title": "Lat Pulldown (Cable)",
                "sets": [
                    {"type": "normal", "weight_kg": 60.0, "reps": 10},
                    {"type": "normal", "weight_kg": 60.0, "reps": 10},
                ],
            },
        ],
    },
    "date": "2026-02-20",
}

SAMPLE_HR = [100, 110, 120, 115, 105]


@patch("strava_push.log_activity_sync")
@patch("strava_push.get_connection")
@patch("strava_push.generate_fit")
def test_push_workout_to_strava_uploads_fit_and_polls(mock_gen_fit, mock_get_conn, mock_log_sync):
    """Happy path: generates FIT, uploads, polls, logs sync, returns sent."""
    from strava_push import push_workout_to_strava

    # Mock generate_fit to create a dummy file at the requested path
    def fake_generate_fit(hevy_workout, hr_samples, output_path):
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        with open(output_path, "wb") as f:
            f.write(b"\x00" * 100)
        return {
            "exercises": 1,
            "total_sets": 2,
            "hr_samples": 5,
            "calories": 300,
            "avg_hr": 110,
            "duration_s": 3600.0,
            "output_path": output_path,
        }

    mock_gen_fit.side_effect = fake_generate_fit

    # Mock Strava client
    mock_client = MagicMock()
    mock_client.upload_activity.return_value = {
        "id": 99001,
        "status": "Your activity is still being processed.",
        "activity_id": None,
    }
    mock_client.check_upload_status.return_value = {
        "id": 99001,
        "activity_id": 777888,
        "error": None,
    }

    # Mock DB connection context manager
    mock_conn = MagicMock()
    mock_get_conn.return_value.__enter__ = MagicMock(return_value=mock_conn)
    mock_get_conn.return_value.__exit__ = MagicMock(return_value=False)

    result = push_workout_to_strava(mock_client, SAMPLE_WORKOUT, SAMPLE_HR, rule_id=42)

    # Verify result
    assert result["status"] == "sent"
    assert result["strava_activity_id"] == 777888
    assert result["error"] is None

    # Verify FIT was generated
    mock_gen_fit.assert_called_once()
    call_args = mock_gen_fit.call_args
    assert call_args[1]["hevy_workout"] == SAMPLE_WORKOUT["hevy_workout"]
    assert call_args[1]["hr_samples"] == SAMPLE_HR
    assert call_args[1]["output_path"].endswith(".fit")

    # Verify upload was called with FIT file path
    mock_client.upload_activity.assert_called_once()
    upload_args = mock_client.upload_activity.call_args
    assert upload_args[1]["name"] == "Pull Day"
    assert upload_args[1]["sport_type"] == "WeightTraining"

    # Verify poll was called (since upload returned no activity_id)
    mock_client.check_upload_status.assert_called_once_with(99001)

    # Verify sync was logged
    mock_log_sync.assert_called_once_with(
        mock_conn,
        source_platform="hevy",
        source_id="abc-123",
        destination="strava",
        destination_id="777888",
        rule_id=42,
        status="sent",
        error_message=None,
    )

    # Verify temp FIT file was cleaned up
    fit_path = mock_gen_fit.call_args[1]["output_path"]
    assert not os.path.exists(fit_path)


@patch("strava_push.log_activity_sync")
@patch("strava_push.get_connection")
@patch("strava_push.generate_fit")
def test_push_workout_handles_upload_error(mock_gen_fit, mock_get_conn, mock_log_sync):
    """Strava returns error (e.g. duplicate), returns error status."""
    from strava_push import push_workout_to_strava

    # Mock generate_fit
    def fake_generate_fit(hevy_workout, hr_samples, output_path):
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        with open(output_path, "wb") as f:
            f.write(b"\x00" * 100)
        return {
            "exercises": 1,
            "total_sets": 2,
            "hr_samples": 5,
            "calories": 300,
            "avg_hr": 110,
            "duration_s": 3600.0,
            "output_path": output_path,
        }

    mock_gen_fit.side_effect = fake_generate_fit

    # Mock Strava client - upload succeeds but poll returns error
    mock_client = MagicMock()
    mock_client.upload_activity.return_value = {
        "id": 99002,
        "status": "Your activity is still being processed.",
        "activity_id": None,
    }
    mock_client.check_upload_status.return_value = {
        "id": 99002,
        "activity_id": None,
        "error": "abc-123.fit duplicate of activity 777888",
    }

    # Mock DB connection
    mock_conn = MagicMock()
    mock_get_conn.return_value.__enter__ = MagicMock(return_value=mock_conn)
    mock_get_conn.return_value.__exit__ = MagicMock(return_value=False)

    result = push_workout_to_strava(mock_client, SAMPLE_WORKOUT, SAMPLE_HR)

    # Verify error result
    assert result["status"] == "error"
    assert result["strava_activity_id"] is None
    assert "duplicate" in result["error"]

    # Verify sync was logged with error status
    mock_log_sync.assert_called_once_with(
        mock_conn,
        source_platform="hevy",
        source_id="abc-123",
        destination="strava",
        destination_id=None,
        rule_id=None,
        status="error",
        error_message="abc-123.fit duplicate of activity 777888",
    )

    # Verify temp FIT file was cleaned up even on error
    fit_path = mock_gen_fit.call_args[1]["output_path"]
    assert not os.path.exists(fit_path)


@patch("strava_push.time.sleep")
@patch("strava_push.log_activity_sync")
@patch("strava_push.get_connection")
@patch("strava_push.generate_fit")
def test_push_workout_polls_until_ready(mock_gen_fit, mock_get_conn, mock_log_sync, mock_sleep):
    """Polls multiple times before activity_id is available."""
    from strava_push import push_workout_to_strava

    def fake_generate_fit(hevy_workout, hr_samples, output_path):
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        with open(output_path, "wb") as f:
            f.write(b"\x00" * 100)
        return {
            "exercises": 1, "total_sets": 2, "hr_samples": 0,
            "calories": 200, "avg_hr": None, "duration_s": 3600.0,
            "output_path": output_path,
        }

    mock_gen_fit.side_effect = fake_generate_fit

    mock_client = MagicMock()
    mock_client.upload_activity.return_value = {
        "id": 99003, "status": "processing", "activity_id": None,
    }
    # First two polls: still processing. Third: ready.
    mock_client.check_upload_status.side_effect = [
        {"id": 99003, "activity_id": None, "error": None},
        {"id": 99003, "activity_id": None, "error": None},
        {"id": 99003, "activity_id": 999111, "error": None},
    ]

    mock_conn = MagicMock()
    mock_get_conn.return_value.__enter__ = MagicMock(return_value=mock_conn)
    mock_get_conn.return_value.__exit__ = MagicMock(return_value=False)

    result = push_workout_to_strava(mock_client, SAMPLE_WORKOUT, None)

    assert result["status"] == "sent"
    assert result["strava_activity_id"] == 999111
    assert mock_client.check_upload_status.call_count == 3
    # Verify sleep was called between polls
    assert mock_sleep.call_count >= 2


@patch("strava_push.time.sleep")
@patch("strava_push.log_activity_sync")
@patch("strava_push.get_connection")
@patch("strava_push.generate_fit")
def test_push_workout_max_polls_exceeded(mock_gen_fit, mock_get_conn, mock_log_sync, mock_sleep):
    """Returns error when max polls exceeded without activity_id."""
    from strava_push import push_workout_to_strava, _MAX_UPLOAD_POLLS

    def fake_generate_fit(hevy_workout, hr_samples, output_path):
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        with open(output_path, "wb") as f:
            f.write(b"\x00" * 100)
        return {
            "exercises": 1, "total_sets": 2, "hr_samples": 0,
            "calories": 200, "avg_hr": None, "duration_s": 3600.0,
            "output_path": output_path,
        }

    mock_gen_fit.side_effect = fake_generate_fit

    mock_client = MagicMock()
    mock_client.upload_activity.return_value = {
        "id": 99004, "status": "processing", "activity_id": None,
    }
    # All polls return no activity_id and no error
    mock_client.check_upload_status.return_value = {
        "id": 99004, "activity_id": None, "error": None,
    }

    mock_conn = MagicMock()
    mock_get_conn.return_value.__enter__ = MagicMock(return_value=mock_conn)
    mock_get_conn.return_value.__exit__ = MagicMock(return_value=False)

    result = push_workout_to_strava(mock_client, SAMPLE_WORKOUT, None)

    assert result["status"] == "error"
    assert result["strava_activity_id"] is None
    assert "timed out" in result["error"].lower() or "poll" in result["error"].lower()
    assert mock_client.check_upload_status.call_count == _MAX_UPLOAD_POLLS


@patch("strava_push.log_activity_sync")
@patch("strava_push.get_connection")
@patch("strava_push.generate_fit")
def test_push_workout_immediate_activity_id(mock_gen_fit, mock_get_conn, mock_log_sync):
    """Upload response already contains activity_id, no polling needed."""
    from strava_push import push_workout_to_strava

    def fake_generate_fit(hevy_workout, hr_samples, output_path):
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        with open(output_path, "wb") as f:
            f.write(b"\x00" * 100)
        return {
            "exercises": 1, "total_sets": 2, "hr_samples": 0,
            "calories": 200, "avg_hr": None, "duration_s": 3600.0,
            "output_path": output_path,
        }

    mock_gen_fit.side_effect = fake_generate_fit

    mock_client = MagicMock()
    mock_client.upload_activity.return_value = {
        "id": 99005, "status": "ready", "activity_id": 555666,
    }

    mock_conn = MagicMock()
    mock_get_conn.return_value.__enter__ = MagicMock(return_value=mock_conn)
    mock_get_conn.return_value.__exit__ = MagicMock(return_value=False)

    result = push_workout_to_strava(mock_client, SAMPLE_WORKOUT, None)

    assert result["status"] == "sent"
    assert result["strava_activity_id"] == 555666
    # No polling should have happened
    mock_client.check_upload_status.assert_not_called()
