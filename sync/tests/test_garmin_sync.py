"""Test Garmin sync logic with mocked API calls."""

from datetime import date
from unittest.mock import MagicMock, patch

import pytest


def test_sync_day_calls_all_endpoints():
    """sync_day should call all daily and range endpoints for a given date."""
    mock_client = MagicMock()
    mock_client.get_stats.return_value = {"totalSteps": 5000}
    mock_client.get_heart_rates.return_value = {"restingHeartRate": 60}
    mock_client.get_sleep_data.return_value = {"dailySleepDTO": {}}
    mock_client.get_all_day_stress.return_value = {"avgStressLevel": 25}
    mock_client.get_hrv_data.return_value = {"weeklyAvg": 50}
    mock_client.get_spo2_data.return_value = None
    mock_client.get_body_battery.return_value = [{"charged": 70}]
    mock_client.get_weigh_ins.return_value = {"dateWeightList": []}
    mock_client.get_body_composition.return_value = {"bodyFat": 18.5}

    with patch("garmin_sync.get_connection") as mock_conn, \
         patch("garmin_sync.upsert_raw_data") as mock_upsert, \
         patch("garmin_sync.rate_limited_call", side_effect=lambda fn, *a, **kw: fn(*a, **kw)):

        mock_conn.return_value.__enter__ = MagicMock(return_value=MagicMock())
        mock_conn.return_value.__exit__ = MagicMock(return_value=False)

        from garmin_sync import sync_day
        count = sync_day(mock_client, date(2026, 2, 20))

        # 6 daily + 3 range = 9 endpoints, minus spo2 (None) = 8
        assert count == 8
        assert mock_upsert.call_count == 8


def test_sync_day_handles_endpoint_failure_gracefully():
    """If one endpoint fails, others should still sync."""
    mock_client = MagicMock()
    mock_client.get_stats.return_value = {"totalSteps": 5000}
    mock_client.get_heart_rates.side_effect = Exception("API error")
    mock_client.get_sleep_data.return_value = {"dailySleepDTO": {}}
    mock_client.get_all_day_stress.return_value = {"avgStressLevel": 25}
    mock_client.get_hrv_data.return_value = None
    mock_client.get_spo2_data.return_value = None
    mock_client.get_body_battery.return_value = [{"charged": 70}]
    mock_client.get_weigh_ins.return_value = {"dateWeightList": []}
    mock_client.get_body_composition.return_value = {"bodyFat": 18.5}

    with patch("garmin_sync.get_connection") as mock_conn, \
         patch("garmin_sync.upsert_raw_data") as mock_upsert, \
         patch("garmin_sync.rate_limited_call", side_effect=lambda fn, *a, **kw: fn(*a, **kw)):

        mock_conn.return_value.__enter__ = MagicMock(return_value=MagicMock())
        mock_conn.return_value.__exit__ = MagicMock(return_value=False)

        from garmin_sync import sync_day
        count = sync_day(mock_client, date(2026, 2, 20))

        # heart_rates failed, spo2+hrv returned None, rest OK = 6 successful
        assert count == 6
