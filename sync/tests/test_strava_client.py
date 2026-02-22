"""Test Strava API client with mocked HTTP requests."""

import time
from unittest.mock import patch, MagicMock

import pytest

from strava_client import StravaClient


@pytest.fixture
def client():
    return StravaClient(access_token="test_token", refresh_token="test_refresh")


def _mock_response(json_data, status_code=200, headers=None):
    resp = MagicMock()
    resp.status_code = status_code
    resp.json.return_value = json_data
    resp.headers = headers or {}
    resp.raise_for_status = MagicMock()
    if status_code >= 400:
        resp.raise_for_status.side_effect = Exception(f"HTTP {status_code}")
    return resp


def test_client_init_with_tokens():
    client = StravaClient(access_token="test_token", refresh_token="test_refresh")
    assert client.access_token == "test_token"
    assert client.refresh_token == "test_refresh"


def test_client_auth_header():
    client = StravaClient(access_token="abc123")
    assert client.session.headers["Authorization"] == "Bearer abc123"


def test_client_rate_limiting():
    client = StravaClient(access_token="test")
    resp = _mock_response({"id": 1})
    with patch.object(client.session, "get", return_value=resp):
        start = time.time()
        client._get("/test")
        client._get("/test2")
        elapsed = time.time() - start
        assert elapsed >= 0.3  # At least one rate limit delay


@patch("strava_client.requests.post")
def test_refresh_tokens(mock_post):
    mock_post.return_value = MagicMock(
        status_code=200,
        json=MagicMock(return_value={
            "access_token": "new_access",
            "refresh_token": "new_refresh",
            "expires_at": 9999999999,
        }),
    )
    mock_post.return_value.raise_for_status = MagicMock()
    client = StravaClient(
        access_token="old", refresh_token="old_refresh",
        client_id="123", client_secret="secret",
    )
    client.refresh_tokens()
    assert client.access_token == "new_access"
    assert client.refresh_token == "new_refresh"


def test_get_activities(client):
    resp = _mock_response([{"id": 1, "name": "Run"}])
    with patch.object(client.session, "get", return_value=resp):
        activities = client.get_activities(after=1000000)
        assert len(activities) == 1
        assert activities[0]["id"] == 1


def test_get_activity_detail(client):
    resp = _mock_response({"id": 42, "name": "Morning Run", "calories": 500})
    with patch.object(client.session, "get", return_value=resp):
        detail = client.get_activity(42)
        assert detail["id"] == 42
        assert detail["calories"] == 500


def test_get_activity_streams(client):
    resp = _mock_response([
        {"type": "heartrate", "data": [120, 130, 140]},
        {"type": "time", "data": [0, 10, 20]},
    ])
    with patch.object(client.session, "get", return_value=resp):
        streams = client.get_activity_streams(42, keys=["heartrate", "time"])
        assert len(streams) == 2


def test_retry_adapter_configured(client):
    """Client should have retry adapter configured for transient errors."""
    adapter = client.session.get_adapter("https://www.strava.com")
    retry = adapter.max_retries
    assert retry.total == 3
    assert retry.backoff_factor == 2
    assert 500 in retry.status_forcelist
    assert 502 in retry.status_forcelist
    assert 503 in retry.status_forcelist
    assert 504 in retry.status_forcelist
    assert set(retry.allowed_methods) == {"GET", "POST"}
