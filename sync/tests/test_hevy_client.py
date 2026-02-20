"""Test Hevy API client with mocked HTTP requests."""

from unittest.mock import patch, MagicMock

import pytest
from urllib3.util.retry import Retry

from hevy_client import HevyClient


@pytest.fixture
def client():
    return HevyClient(api_key="test-key")


def _mock_response(json_data, status_code=200):
    resp = MagicMock()
    resp.status_code = status_code
    resp.json.return_value = json_data
    resp.raise_for_status = MagicMock()
    if status_code >= 400:
        resp.raise_for_status.side_effect = Exception(f"HTTP {status_code}")
    return resp


def test_client_sets_auth_header(client):
    assert client.session.headers["api-key"] == "test-key"


def test_get_workout_count(client):
    with patch.object(client.session, "get", return_value=_mock_response({"workout_count": 247})):
        count = client.get_workout_count()
        assert count == 247


def test_get_workouts_page(client):
    page_data = {
        "page": 1,
        "page_count": 25,
        "workouts": [{"id": "w1", "title": "Push Day"}],
    }
    with patch.object(client.session, "get", return_value=_mock_response(page_data)):
        result = client.get_workouts(page=1, page_size=10)
        assert result["workouts"][0]["id"] == "w1"
        assert result["page_count"] == 25


def test_get_exercise_templates(client):
    data = {
        "page": 1,
        "page_count": 3,
        "exercise_templates": [{"id": "t1", "title": "Bench Press"}],
    }
    with patch.object(client.session, "get", return_value=_mock_response(data)):
        result = client.get_exercise_templates(page=1)
        assert result["exercise_templates"][0]["title"] == "Bench Press"


def test_get_routines(client):
    data = {
        "page": 1,
        "page_count": 1,
        "routines": [{"id": "r1", "title": "PPL"}],
    }
    with patch.object(client.session, "get", return_value=_mock_response(data)):
        result = client.get_routines(page=1)
        assert result["routines"][0]["title"] == "PPL"


def test_retry_adapter_configured(client):
    """Client should have retry adapter configured for transient errors."""
    adapter = client.session.get_adapter("https://api.hevyapp.com")
    retry: Retry = adapter.max_retries
    assert retry.total == 5
    assert retry.backoff_factor == 2
    assert 429 in retry.status_forcelist
    assert 500 in retry.status_forcelist
    assert 502 in retry.status_forcelist
    assert 503 in retry.status_forcelist
    assert 504 in retry.status_forcelist
    assert set(retry.allowed_methods) == {"GET"}
