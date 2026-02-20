"""Test Garmin sync logic with mocked API calls."""

from datetime import date
from unittest.mock import MagicMock, patch

import pytest


def _make_mock_client():
    """Create a mock Garmin client that returns data for all endpoints."""
    mock = MagicMock()
    # By default, MagicMock returns a MagicMock for any method call,
    # which is truthy, so all endpoints will "succeed"
    return mock


def test_sync_day_saves_successful_endpoints():
    """sync_day should save data for all endpoints that return data."""
    mock_client = _make_mock_client()
    mock_client.get_spo2_data.return_value = None

    with patch("garmin_sync.get_connection") as mock_conn, \
         patch("garmin_sync.upsert_raw_data") as mock_upsert, \
         patch("garmin_sync.rate_limited_call", side_effect=lambda fn, *a, **kw: fn(*a, **kw)):

        mock_conn.return_value.__enter__ = MagicMock(return_value=MagicMock())
        mock_conn.return_value.__exit__ = MagicMock(return_value=False)

        from garmin_sync import sync_day, DAILY_ENDPOINTS, RANGE_ENDPOINTS
        count = sync_day(mock_client, date(2026, 2, 20))

        expected = len(DAILY_ENDPOINTS) + len(RANGE_ENDPOINTS) - 1  # minus spo2 (None)
        assert count == expected


def test_sync_day_handles_endpoint_failure_gracefully():
    """If one endpoint fails, others should still sync."""
    mock_client = _make_mock_client()
    mock_client.get_heart_rates.side_effect = Exception("API error")
    mock_client.get_spo2_data.return_value = None

    with patch("garmin_sync.get_connection") as mock_conn, \
         patch("garmin_sync.upsert_raw_data") as mock_upsert, \
         patch("garmin_sync.rate_limited_call", side_effect=lambda fn, *a, **kw: fn(*a, **kw)):

        mock_conn.return_value.__enter__ = MagicMock(return_value=MagicMock())
        mock_conn.return_value.__exit__ = MagicMock(return_value=False)

        from garmin_sync import sync_day, DAILY_ENDPOINTS, RANGE_ENDPOINTS
        count = sync_day(mock_client, date(2026, 2, 20))

        expected = len(DAILY_ENDPOINTS) + len(RANGE_ENDPOINTS) - 2  # minus heart_rates + spo2
        assert count == expected
