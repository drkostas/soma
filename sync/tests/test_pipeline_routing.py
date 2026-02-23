"""Tests for pipeline routing step — _route_enriched_workouts()."""

import json
from unittest.mock import patch, MagicMock, call

import pytest


SAMPLE_RULES = [
    {
        "id": 1,
        "source_platform": "hevy",
        "activity_type": "strength",
        "preprocessing": [],
        "destinations": [{"platform": "strava", "format": "fit"}],
    },
]

SAMPLE_RAW_JSON = {
    "id": "abc-123",
    "title": "Pull Day",
    "start_time": "2026-02-20T10:00:00Z",
    "end_time": "2026-02-20T11:00:00Z",
    "exercises": [],
}

SAMPLE_HR = [100, 110, 120, 115, 105]


@patch("pipeline.execute_routes")
@patch("pipeline.get_sync_rules")
@patch("pipeline.get_connection")
def test_pipeline_route_step_calls_execute_routes(
    mock_get_conn, mock_get_rules, mock_exec_routes,
):
    """_route_enriched_workouts fetches enriched workouts and calls execute_routes for each."""
    from pipeline import _route_enriched_workouts

    # Set up DB connection mock
    mock_conn = MagicMock()
    mock_get_conn.return_value.__enter__ = MagicMock(return_value=mock_conn)
    mock_get_conn.return_value.__exit__ = MagicMock(return_value=False)

    # Rules returned by get_sync_rules
    mock_get_rules.return_value = SAMPLE_RULES

    # Mock cursor for the enriched workouts query
    mock_cursor = MagicMock()
    mock_conn.cursor.return_value.__enter__ = MagicMock(return_value=mock_cursor)
    mock_conn.cursor.return_value.__exit__ = MagicMock(return_value=False)
    mock_cursor.fetchall.return_value = [
        (
            "abc-123",                  # hevy_id
            "Pull Day",                 # hevy_title
            json.dumps(SAMPLE_RAW_JSON),  # raw_json (string from DB)
            SAMPLE_HR,                  # hr_samples
        ),
    ]

    # execute_routes returns a successful result
    mock_exec_routes.return_value = [
        {"destination": "strava", "rule_id": 1, "status": "sent",
         "strava_activity_id": 999, "error": None},
    ]

    mock_strava = MagicMock()
    count = _route_enriched_workouts(strava_client=mock_strava)

    # get_sync_rules called for hevy, enabled only
    mock_get_rules.assert_called_once_with(
        mock_conn, source_platform="hevy", enabled_only=True,
    )

    # execute_routes called once for the one enriched workout
    mock_exec_routes.assert_called_once()
    call_kwargs = mock_exec_routes.call_args
    assert call_kwargs[1]["source_platform"] == "hevy"
    assert call_kwargs[1]["activity_type"] == "strength"
    assert call_kwargs[1]["strava_client"] is mock_strava
    assert call_kwargs[1]["workout"]["hevy_id"] == "abc-123"
    assert call_kwargs[1]["workout"]["hevy_title"] == "Pull Day"
    assert call_kwargs[1]["hr_samples"] == SAMPLE_HR

    # Returns count of successfully routed activities
    assert count == 1


@patch("pipeline.execute_routes")
@patch("pipeline.get_sync_rules")
@patch("pipeline.get_connection")
def test_route_step_returns_zero_when_no_rules(
    mock_get_conn, mock_get_rules, mock_exec_routes,
):
    """Returns 0 immediately when no sync rules exist."""
    from pipeline import _route_enriched_workouts

    mock_conn = MagicMock()
    mock_get_conn.return_value.__enter__ = MagicMock(return_value=mock_conn)
    mock_get_conn.return_value.__exit__ = MagicMock(return_value=False)

    mock_get_rules.return_value = []

    count = _route_enriched_workouts()
    assert count == 0
    mock_exec_routes.assert_not_called()


@patch("pipeline.execute_routes")
@patch("pipeline.get_sync_rules")
@patch("pipeline.get_connection")
def test_route_step_returns_zero_when_no_enriched_workouts(
    mock_get_conn, mock_get_rules, mock_exec_routes,
):
    """Returns 0 when rules exist but no enriched workouts are found."""
    from pipeline import _route_enriched_workouts

    mock_conn = MagicMock()
    mock_get_conn.return_value.__enter__ = MagicMock(return_value=mock_conn)
    mock_get_conn.return_value.__exit__ = MagicMock(return_value=False)

    mock_get_rules.return_value = SAMPLE_RULES

    mock_cursor = MagicMock()
    mock_conn.cursor.return_value.__enter__ = MagicMock(return_value=mock_cursor)
    mock_conn.cursor.return_value.__exit__ = MagicMock(return_value=False)
    mock_cursor.fetchall.return_value = []

    count = _route_enriched_workouts()
    assert count == 0
    mock_exec_routes.assert_not_called()


@patch("pipeline.execute_routes")
@patch("pipeline.get_sync_rules")
@patch("pipeline.get_connection")
def test_route_step_counts_only_sent_results(
    mock_get_conn, mock_get_rules, mock_exec_routes,
):
    """Only results with status='sent' count toward the returned total."""
    from pipeline import _route_enriched_workouts

    mock_conn = MagicMock()
    mock_get_conn.return_value.__enter__ = MagicMock(return_value=mock_conn)
    mock_get_conn.return_value.__exit__ = MagicMock(return_value=False)

    mock_get_rules.return_value = SAMPLE_RULES

    mock_cursor = MagicMock()
    mock_conn.cursor.return_value.__enter__ = MagicMock(return_value=mock_cursor)
    mock_conn.cursor.return_value.__exit__ = MagicMock(return_value=False)
    mock_cursor.fetchall.return_value = [
        ("abc-123", "Pull Day", json.dumps(SAMPLE_RAW_JSON), SAMPLE_HR),
        ("def-456", "Push Day", json.dumps(SAMPLE_RAW_JSON), None),
    ]

    # First workout succeeds, second fails
    mock_exec_routes.side_effect = [
        [{"destination": "strava", "rule_id": 1, "status": "sent",
          "strava_activity_id": 999, "error": None}],
        [{"destination": "strava", "rule_id": 1, "status": "error",
          "strava_activity_id": None, "error": "upload failed"}],
    ]

    count = _route_enriched_workouts(strava_client=MagicMock())
    assert count == 1
    assert mock_exec_routes.call_count == 2
