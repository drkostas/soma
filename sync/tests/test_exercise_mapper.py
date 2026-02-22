"""Test exercise_mapper maps Hevy names to Garmin FIT category/subcategory IDs."""

from exercise_mapper import HEVY_TO_GARMIN, lookup_exercise


# ---------------------------------------------------------------------------
# Known exercises return correct (category, subcategory, display_name)
# ---------------------------------------------------------------------------

def test_bench_press_barbell():
    cat, sub, name = lookup_exercise("Bench Press (Barbell)")
    assert cat == 0
    assert sub == 1
    assert name == "Bench Press (Barbell)"


def test_deadlift_barbell():
    cat, sub, name = lookup_exercise("Deadlift (Barbell)")
    assert cat == 8
    assert sub == 0
    assert name == "Deadlift (Barbell)"


def test_pull_up():
    cat, sub, name = lookup_exercise("Pull Up")
    assert cat == 21
    assert sub == 38
    assert name == "Pull Up"


def test_plank():
    cat, sub, name = lookup_exercise("Plank")
    assert cat == 19
    assert sub == 43
    assert name == "Plank"


def test_lat_pulldown_cable():
    cat, sub, name = lookup_exercise("Lat Pulldown (Cable)")
    assert cat == 21
    assert sub == 13
    assert name == "Lat Pulldown (Cable)"


def test_leg_press():
    cat, sub, name = lookup_exercise("Leg Press (Machine)")
    assert cat == 28
    assert sub == 0
    assert name == "Leg Press (Machine)"


def test_bicep_curl_barbell():
    cat, sub, name = lookup_exercise("Bicep Curl (Barbell)")
    assert cat == 7
    assert sub == 3
    assert name == "Bicep Curl (Barbell)"


def test_shoulder_press_dumbbell():
    cat, sub, name = lookup_exercise("Shoulder Press (Dumbbell)")
    assert cat == 24
    assert sub == 15
    assert name == "Shoulder Press (Dumbbell)"


# ---------------------------------------------------------------------------
# Unknown exercises return sentinel (65534, 0, name)
# ---------------------------------------------------------------------------

def test_unknown_exercise_returns_sentinel():
    cat, sub, name = lookup_exercise("Underwater Basket Weaving")
    assert cat == 65534
    assert sub == 0
    assert name == "Underwater Basket Weaving"


def test_unknown_exercise_preserves_name():
    cat, sub, name = lookup_exercise("Flamingo Stance (Single Leg)")
    assert name == "Flamingo Stance (Single Leg)"
    assert cat == 65534
    assert sub == 0


def test_empty_string_returns_sentinel():
    cat, sub, name = lookup_exercise("")
    assert cat == 65534
    assert sub == 0
    assert name == ""


# ---------------------------------------------------------------------------
# All 433 exercises are mapped (none fall through to sentinel)
# ---------------------------------------------------------------------------

def test_all_433_exercises_are_mapped():
    assert len(HEVY_TO_GARMIN) == 433, (
        f"Expected 433 mapped exercises, got {len(HEVY_TO_GARMIN)}"
    )


def test_no_exercise_returns_sentinel():
    """Every entry in HEVY_TO_GARMIN must resolve and preserve display name.

    Some exercises intentionally use UNKNOWN (65534) because the FIT SDK
    lacks a matching category (e.g. neck exercises). That is acceptable.
    """
    _INTENTIONAL_UNKNOWN = {
        "Lying Neck Curls",
        "Lying Neck Curls (Weighted)",
        "Lying Neck Extension",
        "Lying Neck Extension (Weighted)",
    }
    for hevy_name in HEVY_TO_GARMIN:
        cat, sub, display = lookup_exercise(hevy_name)
        if hevy_name not in _INTENTIONAL_UNKNOWN:
            assert cat != 65534, f"{hevy_name!r} unexpectedly returned sentinel"
        assert display == hevy_name


# ---------------------------------------------------------------------------
# HEVY_TO_GARMIN dict structure checks
# ---------------------------------------------------------------------------

def test_mapping_values_are_int_tuples():
    """Every value must be a (int, int) tuple."""
    for name, val in HEVY_TO_GARMIN.items():
        assert isinstance(val, tuple), f"{name}: expected tuple, got {type(val)}"
        assert len(val) == 2, f"{name}: expected 2-tuple, got {len(val)}-tuple"
        assert isinstance(val[0], int), f"{name}: category must be int"
        assert isinstance(val[1], int), f"{name}: subcategory must be int"


def test_mapping_keys_are_nonempty_strings():
    """Every key must be a non-empty string."""
    for name in HEVY_TO_GARMIN:
        assert isinstance(name, str) and len(name) > 0
