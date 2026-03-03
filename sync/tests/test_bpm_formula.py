# sync/tests/test_bpm_formula.py
from bpm_formula import hrr_to_bpm, latest_hr_from_garmin_data


def test_resting_hr_gives_low_bpm():
    """0% HRR → 75 BPM"""
    assert hrr_to_bpm(hr=60, hr_rest=60, hr_max=190) == 75


def test_max_hr_gives_high_bpm():
    """100% HRR → 175 BPM"""
    assert hrr_to_bpm(hr=190, hr_rest=60, hr_max=190) == 175


def test_moderate_effort_interpolation():
    """50% HRR → 128 BPM"""
    hr_rest, hr_max = 60, 190
    hr_at_50_pct = hr_rest + 0.5 * (hr_max - hr_rest)  # = 125
    result = hrr_to_bpm(hr=hr_at_50_pct, hr_rest=hr_rest, hr_max=hr_max)
    assert result == 128


def test_clamp_below_zero():
    """HR below rest → clamped to 70 BPM floor"""
    assert hrr_to_bpm(hr=40, hr_rest=60, hr_max=190) == 70


def test_clamp_above_max():
    """HR above max → clamped to 185 BPM ceiling"""
    assert hrr_to_bpm(hr=220, hr_rest=60, hr_max=190) == 185


def test_pump_up_offset():
    """Pump up adds +12"""
    bpm = hrr_to_bpm(hr=125, hr_rest=60, hr_max=190, offset=12)
    assert bpm == 140  # 128 + 12


def test_wind_down_offset():
    """Wind down subtracts 12"""
    bpm = hrr_to_bpm(hr=125, hr_rest=60, hr_max=190, offset=-12)
    assert bpm == 116  # 128 - 12


def test_latest_hr_returns_recent_reading():
    """Should return the most recent non-null reading within 2 minutes."""
    import time
    now_ms = int(time.time() * 1000)
    data = {
        "heartRateValues": [
            [now_ms - 90_000, 145],   # 90 seconds ago — within 2 min window
            [now_ms - 180_000, 130],  # 3 minutes ago — outside window
        ]
    }
    assert latest_hr_from_garmin_data(data, window_seconds=120) == 145


def test_latest_hr_returns_none_when_stale():
    """All readings older than window → return None."""
    import time
    now_ms = int(time.time() * 1000)
    data = {
        "heartRateValues": [
            [now_ms - 300_000, 145],  # 5 minutes ago
        ]
    }
    assert latest_hr_from_garmin_data(data, window_seconds=120) is None


def test_latest_hr_skips_null_values():
    """Null HR readings (e.g., watch removed) should be skipped."""
    import time
    now_ms = int(time.time() * 1000)
    data = {
        "heartRateValues": [
            [now_ms - 30_000, None],  # null — skip
            [now_ms - 60_000, 138],   # valid
        ]
    }
    assert latest_hr_from_garmin_data(data, window_seconds=120) == 138
