"""Tests for kite-aware Strava naming + description (garmin_push)."""

from garmin_push import generate_kite_strava_description, kite_activity_name

SUMMARY = {
    "activityName": "Kiteboarding",
    "distance": 25750.0,      # m
    "maxSpeed": 10.1,         # m/s -> ~19.6 kn
    "movingDuration": 5760,   # 1h 36m
    "averageHR": 149,
}
PAYLOAD = {
    "summary": {"spot": "Schinias", "jump_count": 29, "max_height_m": 5.2, "max_airtime_s": 5.43},
    "jumps": [
        {"rank": 1, "height_m": 5.2, "airtime_s": 5.2, "distance_m": 17.1},
        {"rank": 2, "height_m": 4.74, "airtime_s": 5.43, "distance_m": 27.0},
        {"rank": 3, "height_m": 4.23},
    ],
}


def test_kite_name_with_jumps():
    assert kite_activity_name(SUMMARY, PAYLOAD) == "Schinias · Max Jump: 5.2m · 29 jumps"


def test_kite_name_no_jumps_falls_back():
    assert kite_activity_name(SUMMARY, {"summary": {"jump_count": 0}}) == "Kiteboarding"


def test_kite_description_headline_and_units():
    desc = generate_kite_strava_description(SUMMARY, PAYLOAD)
    assert "Max Jump: 5.2 m" in desc
    assert "29 jumps" in desc
    assert "19.6 kn" in desc          # knots, not km/h
    assert "25.8 km" in desc          # distance
    assert "1h 36m" in desc           # moving duration
    assert "github.com/drkostas/soma" in desc


def test_kite_description_top_jumps_ranked():
    desc = generate_kite_strava_description(SUMMARY, PAYLOAD)
    assert "Top jumps:" in desc
    assert "1. 5.2 m, 5.2 s air, 17.1 m" in desc
    assert "3. 4.23 m" in desc        # rank 3 has no airtime/distance -> height only


def test_kite_description_empty_session():
    assert generate_kite_strava_description(SUMMARY, {"summary": {}, "jumps": []}) != ""
