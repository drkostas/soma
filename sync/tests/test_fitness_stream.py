"""Tests for Fitness Stream — EF, decoupling, and VO2max extraction."""

from training_engine.fitness_stream import (
    compute_efficiency_factor,
    compute_decoupling,
    extract_vo2max,
)


def test_efficiency_factor():
    """EF = speed / HR."""
    # 5:30/km = 330 sec/km, HR=150
    ef = compute_efficiency_factor(330, 150)
    # speed = 1/330 = 0.00303, ef = 0.00303/150 = 0.00002020
    assert abs(ef - 0.00002020) < 0.000001


def test_efficiency_factor_zero_pace():
    """Zero pace returns 0."""
    assert compute_efficiency_factor(0, 150) == 0.0


def test_efficiency_factor_zero_hr():
    """Zero HR returns 0."""
    assert compute_efficiency_factor(330, 0) == 0.0


def test_efficiency_factor_negative_inputs():
    """Negative inputs return 0."""
    assert compute_efficiency_factor(-100, 150) == 0.0
    assert compute_efficiency_factor(330, -50) == 0.0


def test_efficiency_factor_faster_pace_higher_ef():
    """Faster pace (lower sec/km) should produce higher EF at same HR."""
    ef_fast = compute_efficiency_factor(300, 150)  # 5:00/km
    ef_slow = compute_efficiency_factor(360, 150)  # 6:00/km
    assert ef_fast > ef_slow


def test_efficiency_factor_lower_hr_higher_ef():
    """Lower HR at same pace should produce higher EF."""
    ef_low_hr = compute_efficiency_factor(330, 140)
    ef_high_hr = compute_efficiency_factor(330, 160)
    assert ef_low_hr > ef_high_hr


def test_decoupling_normal():
    """< 5% decoupling = aerobically coupled."""
    first = {"pace_sec_km": 330, "avg_hr": 145}
    second = {"pace_sec_km": 330, "avg_hr": 152}
    d = compute_decoupling(first, second)
    # Same pace, higher HR in second half => positive decoupling
    # EF1 = (1/330)/145, EF2 = (1/330)/152
    # decoupling = (1/145 - 1/152) / (1/145) * 100 = (152-145)/152 * 100 = 4.605%
    assert 4.0 < d < 5.5


def test_decoupling_negative_split():
    """Negative decoupling = got faster without HR rise."""
    first = {"pace_sec_km": 340, "avg_hr": 148}
    second = {"pace_sec_km": 320, "avg_hr": 148}
    d = compute_decoupling(first, second)
    assert d < 0  # negative = got more efficient


def test_decoupling_zero():
    """Same EF both halves = 0% decoupling."""
    half = {"pace_sec_km": 330, "avg_hr": 150}
    assert compute_decoupling(half, half) == 0.0


def test_decoupling_high_cardiac_drift():
    """Significant HR increase with same pace = high decoupling."""
    first = {"pace_sec_km": 330, "avg_hr": 140}
    second = {"pace_sec_km": 330, "avg_hr": 165}
    d = compute_decoupling(first, second)
    assert d > 10  # significant drift


def test_decoupling_zero_ef_first_half():
    """If first half EF is 0 (bad data), return 0."""
    first = {"pace_sec_km": 0, "avg_hr": 150}
    second = {"pace_sec_km": 330, "avg_hr": 150}
    assert compute_decoupling(first, second) == 0.0


def test_extract_vo2max_list():
    """Extract from list format with generic.vo2MaxPreciseValue."""
    raw = [{"generic": {"vo2MaxPreciseValue": 49.5}}]
    assert extract_vo2max(raw) == 49.5


def test_extract_vo2max_dict():
    """Extract from dict format with generic.vo2MaxPreciseValue."""
    raw = {"generic": {"vo2MaxPreciseValue": 48.2}}
    assert extract_vo2max(raw) == 48.2


def test_extract_vo2max_none():
    """Returns None for empty data."""
    assert extract_vo2max({}) is None
    assert extract_vo2max([]) is None


def test_extract_vo2max_flat():
    """Some API versions return vo2MaxPreciseValue at top level."""
    raw = [{"vo2MaxPreciseValue": 47.0}]
    assert extract_vo2max(raw) == 47.0


def test_extract_vo2max_flat_dict():
    """Top-level vo2MaxPreciseValue in dict format."""
    raw = {"vo2MaxPreciseValue": 51.3}
    assert extract_vo2max(raw) == 51.3


def test_extract_vo2max_multiple_entries():
    """Returns first valid VO2max from a list with multiple entries."""
    raw = [
        {"generic": {"someOtherField": 123}},
        {"generic": {"vo2MaxPreciseValue": 46.8}},
    ]
    assert extract_vo2max(raw) == 46.8


def test_extract_vo2max_non_dict_in_list():
    """Gracefully skips non-dict items in list."""
    raw = [None, "string", {"generic": {"vo2MaxPreciseValue": 50.0}}]
    assert extract_vo2max(raw) == 50.0


def test_extract_vo2max_none_input():
    """Returns None for None input."""
    assert extract_vo2max(None) is None


def test_extract_vo2max_returns_float():
    """Result is always a float, even if source is int."""
    raw = [{"generic": {"vo2MaxPreciseValue": 48}}]
    result = extract_vo2max(raw)
    assert result == 48.0
    assert isinstance(result, float)
