import pytest
from unittest.mock import patch, MagicMock


def test_match_rules_exact_type():
    from router import match_rules
    rules = [
        {"id": 1, "source_platform": "hevy", "activity_type": "strength",
         "preprocessing": [], "destinations": [{"platform": "garmin", "format": "fit"}]},
    ]
    matched = match_rules(rules, source_platform="hevy", activity_type="strength")
    assert len(matched) == 1
    assert matched[0]["id"] == 1


def test_match_rules_wildcard_type():
    from router import match_rules
    rules = [
        {"id": 2, "source_platform": "garmin", "activity_type": "*",
         "preprocessing": [], "destinations": [{"platform": "strava", "format": "native"}]},
    ]
    matched = match_rules(rules, source_platform="garmin", activity_type="running")
    assert len(matched) == 1


def test_match_rules_no_match():
    from router import match_rules
    rules = [
        {"id": 1, "source_platform": "hevy", "activity_type": "strength",
         "preprocessing": [], "destinations": [{"platform": "garmin", "format": "fit"}]},
    ]
    matched = match_rules(rules, source_platform="strava", activity_type="running")
    assert len(matched) == 0


def test_match_rules_wrong_type():
    from router import match_rules
    rules = [
        {"id": 1, "source_platform": "garmin", "activity_type": "running",
         "preprocessing": [], "destinations": [{"platform": "strava"}]},
    ]
    matched = match_rules(rules, source_platform="garmin", activity_type="cycling")
    assert len(matched) == 0


def test_anti_loop_skips_same_destination():
    from router import should_sync
    assert should_sync(source_platform="strava", destination="strava") is False


def test_anti_loop_allows_different_destination():
    from router import should_sync
    assert should_sync(source_platform="hevy", destination="strava") is True


@patch("router.was_already_synced")
def test_anti_loop_skips_already_synced(mock_was_synced):
    from router import should_sync
    mock_was_synced.return_value = True
    conn = MagicMock()
    assert should_sync(source_platform="hevy", destination="garmin",
                       conn=conn, source_id="abc") is False


@patch("router.was_already_synced")
def test_anti_loop_allows_not_yet_synced(mock_was_synced):
    from router import should_sync
    mock_was_synced.return_value = False
    conn = MagicMock()
    assert should_sync(source_platform="hevy", destination="garmin",
                       conn=conn, source_id="abc") is True
