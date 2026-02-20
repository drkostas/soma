"""Test Hevy sync logic with mocked client."""

from unittest.mock import MagicMock, patch, call

from hevy_sync import sync_all_workouts, sync_exercise_templates, sync_routines


def test_sync_all_workouts_paginates():
    """Should fetch all pages until page_count is reached."""
    mock_client = MagicMock()
    mock_client.get_workout_count.return_value = 3
    mock_client.get_workouts.side_effect = [
        {"page": 1, "page_count": 2, "workouts": [
            {"id": "w1", "title": "Push"}, {"id": "w2", "title": "Pull"}
        ]},
        {"page": 2, "page_count": 2, "workouts": [
            {"id": "w3", "title": "Legs"}
        ]},
    ]

    with patch("hevy_sync.get_connection") as mock_conn, \
         patch("hevy_sync.upsert_hevy_raw") as mock_upsert, \
         patch("hevy_sync.update_backfill_progress"):

        mock_conn.return_value.__enter__ = MagicMock(return_value=MagicMock())
        mock_conn.return_value.__exit__ = MagicMock(return_value=False)

        count = sync_all_workouts(mock_client)
        assert count == 3
        assert mock_upsert.call_count == 3


def test_sync_all_workouts_resumes_from_page():
    """Should skip pages already done based on start_page param."""
    mock_client = MagicMock()
    mock_client.get_workout_count.return_value = 3
    mock_client.get_workouts.return_value = {
        "page": 2, "page_count": 2, "workouts": [{"id": "w3", "title": "Legs"}]
    }

    with patch("hevy_sync.get_connection") as mock_conn, \
         patch("hevy_sync.upsert_hevy_raw") as mock_upsert, \
         patch("hevy_sync.update_backfill_progress"):

        mock_conn.return_value.__enter__ = MagicMock(return_value=MagicMock())
        mock_conn.return_value.__exit__ = MagicMock(return_value=False)

        count = sync_all_workouts(mock_client, start_page=2)
        assert count == 1
        mock_client.get_workouts.assert_called_once_with(page=2, page_size=10)


def test_sync_exercise_templates_paginates():
    """Should fetch all template pages."""
    mock_client = MagicMock()
    mock_client.get_exercise_templates.side_effect = [
        {"page": 1, "page_count": 2, "exercise_templates": [
            {"id": "t1", "title": "Bench Press"}
        ]},
        {"page": 2, "page_count": 2, "exercise_templates": [
            {"id": "t2", "title": "Squat"}
        ]},
    ]

    with patch("hevy_sync.get_connection") as mock_conn, \
         patch("hevy_sync.upsert_hevy_raw") as mock_upsert:

        mock_conn.return_value.__enter__ = MagicMock(return_value=MagicMock())
        mock_conn.return_value.__exit__ = MagicMock(return_value=False)

        count = sync_exercise_templates(mock_client)
        assert count == 2


def test_sync_routines_single_page():
    """Should handle single page of routines."""
    mock_client = MagicMock()
    mock_client.get_routines.return_value = {
        "page": 1, "page_count": 1, "routines": [{"id": "r1", "title": "PPL"}]
    }

    with patch("hevy_sync.get_connection") as mock_conn, \
         patch("hevy_sync.upsert_hevy_raw") as mock_upsert:

        mock_conn.return_value.__enter__ = MagicMock(return_value=MagicMock())
        mock_conn.return_value.__exit__ = MagicMock(return_value=False)

        count = sync_routines(mock_client)
        assert count == 1
