"""Test parsers extract correct fields from raw Garmin JSON."""

from datetime import date

from parsers import parse_daily_health, parse_weight_entries, parse_sleep, parse_hrv, parse_training_readiness


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


# --- Tests for new high-value fields ---


def test_parse_daily_health_extracts_body_battery_at_wake():
    raw = {"totalSteps": 5000, "bodyBatteryAtWakeTime": 92}
    result = parse_daily_health(date(2026, 3, 1), raw)
    assert result["body_battery_at_wake"] == 92


def test_parse_daily_health_extracts_rhr_7day_avg():
    raw = {"totalSteps": 5000, "lastSevenDaysAvgRestingHeartRate": 52.3}
    result = parse_daily_health(date(2026, 3, 1), raw)
    assert result["rhr_7day_avg"] == 52.3


def test_parse_daily_health_new_fields_none_when_missing():
    raw = {"totalSteps": 1000}
    result = parse_daily_health(date(2026, 3, 1), raw)
    assert result["body_battery_at_wake"] is None
    assert result["rhr_7day_avg"] is None


def test_parse_hrv_extracts_overnight_hrv():
    raw = {
        "hrvSummary": {
            "weeklyAvg": 65,
            "lastNightAvg": 73,
            "status": "BALANCED",
            "baseline": {"lowUpper": 48, "balancedLow": 52, "balancedUpper": 68},
        }
    }
    result = parse_hrv(raw)
    assert result["avg_overnight_hrv"] == 73
    assert result["hrv_baseline"] == 52


def test_parse_hrv_baseline_none_when_missing():
    raw = {"weeklyAvg": 60, "lastNightAvg": 55, "status": "LOW"}
    result = parse_hrv(raw)
    assert result["avg_overnight_hrv"] == 55
    assert result["hrv_baseline"] is None


def test_parse_hrv_baseline_none_when_baseline_is_none():
    raw = {
        "hrvSummary": {
            "weeklyAvg": 60,
            "lastNightAvg": 55,
            "status": "LOW",
            "baseline": None,
        }
    }
    result = parse_hrv(raw)
    assert result["hrv_baseline"] is None


def test_parse_sleep_extracts_avg_sleep_stress():
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
            "avgSleepStress": 8.5,
        }
    }
    result = parse_sleep(raw)
    assert result["avg_sleep_stress"] == 8.5


def test_parse_sleep_avg_sleep_stress_none_when_missing():
    raw = {
        "dailySleepDTO": {
            "sleepTimeSeconds": 28800,
            "deepSleepSeconds": 7200,
            "lightSleepSeconds": 14400,
            "remSleepSeconds": 5400,
            "awakeSleepSeconds": 1800,
            "sleepScores": {"overall": {"value": 75}},
        }
    }
    result = parse_sleep(raw)
    assert result["avg_sleep_stress"] is None


def test_parse_training_readiness_prefers_valid_sleep():
    raw = [
        {"score": 22, "level": "POOR", "validSleep": False},
        {"score": 55, "level": "MODERATE", "validSleep": True},
        {"score": 25, "level": "LOW", "validSleep": False},
    ]
    result = parse_training_readiness(raw)
    assert result["training_readiness_score"] == 55
    assert result["training_readiness_level"] == "MODERATE"


def test_parse_training_readiness_takes_last_valid_sleep():
    raw = [
        {"score": 40, "level": "LOW", "validSleep": True},
        {"score": 60, "level": "MODERATE", "validSleep": True},
    ]
    result = parse_training_readiness(raw)
    assert result["training_readiness_score"] == 60
    assert result["training_readiness_level"] == "MODERATE"


def test_parse_training_readiness_falls_back_to_first():
    raw = [
        {"score": 30, "level": "LOW", "validSleep": False},
        {"score": 28, "level": "LOW", "validSleep": False},
    ]
    result = parse_training_readiness(raw)
    assert result["training_readiness_score"] == 30
    assert result["training_readiness_level"] == "LOW"


def test_parse_training_readiness_empty_list():
    result = parse_training_readiness([])
    assert result["training_readiness_score"] is None
    assert result["training_readiness_level"] is None


def test_parse_training_readiness_none_input():
    result = parse_training_readiness(None)
    assert result["training_readiness_score"] is None
    assert result["training_readiness_level"] is None


def test_parse_training_readiness_non_list_input():
    result = parse_training_readiness({"score": 50, "level": "MODERATE"})
    assert result["training_readiness_score"] is None
    assert result["training_readiness_level"] is None
