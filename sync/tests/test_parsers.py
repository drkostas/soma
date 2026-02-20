"""Test parsers extract correct fields from raw Garmin JSON."""

from datetime import date

from parsers import parse_daily_health, parse_weight_entries, parse_sleep, parse_hrv


def test_parse_daily_health_extracts_steps():
    raw = {"totalSteps": 8500, "totalKilocalories": 2200, "restingHeartRate": 58}
    result = parse_daily_health(date(2026, 2, 20), raw)
    assert result["total_steps"] == 8500
    assert result["total_kilocalories"] == 2200
    assert result["resting_heart_rate"] == 58
    assert result["date"] == date(2026, 2, 20)


def test_parse_daily_health_handles_missing_fields():
    raw = {"totalSteps": 1000}
    result = parse_daily_health(date(2026, 2, 20), raw)
    assert result["total_steps"] == 1000
    assert result["resting_heart_rate"] is None
    assert result["total_kilocalories"] is None


def test_parse_weight_entries():
    raw = {
        "dateWeightList": [
            {"calendarDate": "2026-02-20", "weight": 82372.0, "bmi": 24.5,
             "bodyFat": 18.0, "bodyWater": None, "boneMass": None,
             "muscleMass": None, "sourceType": "INDEX_SCALE"},
        ]
    }
    entries = parse_weight_entries(raw)
    assert len(entries) == 1
    assert entries[0]["weight_grams"] == 82372.0
    assert entries[0]["date"] == "2026-02-20"
    assert entries[0]["body_fat_pct"] == 18.0


def test_parse_weight_entries_empty():
    raw = {"dateWeightList": []}
    entries = parse_weight_entries(raw)
    assert entries == []


def test_parse_sleep_extracts_stages():
    raw = {
        "dailySleepDTO": {
            "sleepTimeSeconds": 28800,
            "deepSleepSeconds": 7200,
            "lightSleepSeconds": 14400,
            "remSleepSeconds": 5400,
            "awakeSleepSeconds": 1800,
            "sleepScores": {"overall": {"value": 82}},
            "sleepStartTimestampLocal": "2026-02-19T23:30:00",
            "sleepEndTimestampLocal": "2026-02-20T07:30:00",
        }
    }
    result = parse_sleep(raw)
    assert result["total_sleep_seconds"] == 28800
    assert result["deep_sleep_seconds"] == 7200
    assert result["sleep_score"] == 82


def test_parse_sleep_returns_none_when_no_dto():
    raw = {}
    result = parse_sleep(raw)
    assert result is None


def test_parse_hrv():
    raw = {"weeklyAvg": 68, "lastNightAvg": 53, "status": "BALANCED"}
    result = parse_hrv(raw)
    assert result["hrv_weekly_avg"] == 68
    assert result["hrv_status"] == "BALANCED"
