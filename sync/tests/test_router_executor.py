"""Tests for execute_routes() — the router executor that dispatches to push connectors."""

from unittest.mock import patch, MagicMock

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

SAMPLE_WORKOUT = {
    "hevy_id": "abc-123",
    "hevy_title": "Pull Day",
    "hevy_workout": {
        "id": "abc-123",
        "title": "Pull Day",
        "start_time": "2026-02-20T10:00:00Z",
        "end_time": "2026-02-20T11:00:00Z",
        "exercises": [],
    },
    "date": "2026-02-20",
}

SAMPLE_HR = [100, 110, 120, 115, 105]


@patch("router.push_workout_to_strava")
@patch("router.should_sync", return_value=True)
@patch("router.match_rules")
def test_execute_routes_matches_hevy_to_strava(mock_match, mock_should, mock_push):
    """Rule matches hevy->strava, push is called, result returned."""
    from router import execute_routes

    mock_match.return_value = [SAMPLE_RULES[0]]
    mock_push.return_value = {
        "status": "sent",
        "strava_activity_id": 777888,
        "error": None,
    }

    mock_client = MagicMock()
    results = execute_routes(
        rules=SAMPLE_RULES,
        source_platform="hevy",
        activity_type="strength",
        workout=SAMPLE_WORKOUT,
        hr_samples=SAMPLE_HR,
        strava_client=mock_client,
    )

    # match_rules was called with the right arguments
    mock_match.assert_called_once_with(SAMPLE_RULES, "hevy", "strength")

    # should_sync was checked for the destination
    mock_should.assert_called_once_with(
        "hevy", "strava", conn=None, source_id="abc-123",
    )

    # push was dispatched to strava
    mock_push.assert_called_once_with(
        mock_client, SAMPLE_WORKOUT, SAMPLE_HR, rule_id=1,
    )

    # result structure
    assert len(results) == 1
    assert results[0]["destination"] == "strava"
    assert results[0]["rule_id"] == 1
    assert results[0]["status"] == "sent"
    assert results[0]["strava_activity_id"] == 777888
    assert results[0]["error"] is None


@patch("router.push_workout_to_strava")
@patch("router.should_sync", return_value=False)
@patch("router.match_rules")
def test_execute_routes_skips_already_synced(mock_match, mock_should, mock_push):
    """should_sync returns False (already synced), push is NOT called."""
    from router import execute_routes

    mock_match.return_value = [SAMPLE_RULES[0]]

    results = execute_routes(
        rules=SAMPLE_RULES,
        source_platform="hevy",
        activity_type="strength",
        workout=SAMPLE_WORKOUT,
        hr_samples=SAMPLE_HR,
        strava_client=MagicMock(),
    )

    mock_should.assert_called_once()
    mock_push.assert_not_called()
    assert results == []


@patch("router.push_workout_to_strava")
@patch("router.should_sync")
@patch("router.match_rules", return_value=[])
def test_execute_routes_no_matching_rules(mock_match, mock_should, mock_push):
    """No rules match the activity, empty results returned."""
    from router import execute_routes

    results = execute_routes(
        rules=SAMPLE_RULES,
        source_platform="garmin",
        activity_type="running",
        workout={"activity_id": "xyz-789"},
        hr_samples=None,
    )

    mock_match.assert_called_once_with(SAMPLE_RULES, "garmin", "running")
    mock_should.assert_not_called()
    mock_push.assert_not_called()
    assert results == []
