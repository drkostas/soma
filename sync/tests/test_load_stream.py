"""Tests for Load Stream — training load extraction and PMC computation."""

from datetime import date, timedelta

from training_engine.load_stream import compute_activity_load, compute_pmc


def test_compute_activity_load_from_epoc():
    """Extract EPOC from Garmin activity raw data."""
    activity_raw = {
        "activityTrainingLoad": 142.5,
        "duration": 3600,
        "activityType": {"typeKey": "running"},
    }
    load = compute_activity_load(activity_raw, source="garmin_run")
    assert load["load_metric"] == "epoc"
    assert load["load_value"] == 142.5
    assert load["source"] == "garmin_run"
    assert load["duration_seconds"] == 3600


def test_compute_activity_load_no_epoc():
    """Fallback to duration-based estimate when no EPOC."""
    activity_raw = {"duration": 3600, "activityType": {"typeKey": "running"}}
    load = compute_activity_load(activity_raw, source="garmin_run")
    assert load["load_metric"] == "estimated"
    assert load["load_value"] == 90.0  # 60 min × 1.5/min
    assert load["source"] == "garmin_run"
    assert load["duration_seconds"] == 3600


def test_compute_activity_load_zero_epoc():
    """EPOC of 0 should fall back to duration-based estimate."""
    activity_raw = {
        "activityTrainingLoad": 0,
        "duration": 1800,
    }
    load = compute_activity_load(activity_raw, source="garmin_walk")
    assert load["load_metric"] == "estimated"
    assert load["load_value"] == 45.0  # 30 min × 1.5/min


def test_compute_activity_load_negative_epoc():
    """Negative EPOC should fall back to duration-based estimate."""
    activity_raw = {
        "activityTrainingLoad": -5.0,
        "duration": 1800,
    }
    load = compute_activity_load(activity_raw, source="garmin_walk")
    assert load["load_metric"] == "estimated"
    assert load["load_value"] == 45.0  # 30 min × 1.5/min


def test_compute_activity_load_missing_duration():
    """Missing duration should still work, duration_seconds = None."""
    activity_raw = {"activityTrainingLoad": 80.0}
    load = compute_activity_load(activity_raw, source="garmin_cycling")
    assert load["load_metric"] == "epoc"
    assert load["load_value"] == 80.0
    assert load["duration_seconds"] is None


def test_compute_pmc_basic():
    """EWMA computation for CTL (42d) and ATL (7d)."""
    daily_loads = [
        (date(2026, 1, 1) + timedelta(days=i), 100.0) for i in range(50)
    ]
    pmc = compute_pmc(daily_loads)
    assert len(pmc) == 50

    last = pmc[-1]
    # CTL tau=42 converges slowly: after 50 days at constant 100, ~69.6
    assert 65 < last["ctl"] < 75
    # ATL tau=7 converges fast: after 50 days at constant 100, ~99.9
    assert 95 < last["atl"] < 105
    # TSB = CTL - ATL, negative while CTL is still building up
    assert last["tsb"] < 0


def test_compute_pmc_with_rest_days():
    """Rest days (load=0) are included in EWMA correctly."""
    daily_loads = [
        (date(2026, 1, 1), 150.0),
        (date(2026, 1, 2), 0.0),
        (date(2026, 1, 3), 120.0),
    ]
    pmc = compute_pmc(daily_loads)
    assert len(pmc) == 3
    assert pmc[1]["daily_load"] == 0.0
    # After rest day, both CTL and ATL should decay
    assert pmc[1]["ctl"] < pmc[0]["ctl"]
    assert pmc[1]["atl"] < pmc[0]["atl"]


def test_compute_pmc_empty():
    """Empty loads returns empty."""
    assert compute_pmc([]) == []


def test_compute_pmc_tsb_positive_after_rest():
    """TSB goes positive after extended rest following training block."""
    # 14 days of training followed by 14 days of rest
    # ATL (tau=7) decays much faster than CTL (tau=42), so TSB goes positive
    loads = [
        (date(2026, 1, 1) + timedelta(days=i), 120.0) for i in range(14)
    ]
    loads += [
        (date(2026, 1, 15) + timedelta(days=i), 0.0) for i in range(14)
    ]
    pmc = compute_pmc(loads)
    # After 14 days rest, ATL drops faster than CTL -> TSB positive
    assert pmc[-1]["tsb"] > 0


def test_compute_pmc_single_day():
    """Single day of load should produce valid PMC entry."""
    pmc = compute_pmc([(date(2026, 6, 1), 200.0)])
    assert len(pmc) == 1
    assert pmc[0]["daily_load"] == 200.0
    assert pmc[0]["ctl"] > 0
    assert pmc[0]["atl"] > 0
    # ATL alpha is larger so ATL > CTL after first load -> TSB negative
    assert pmc[0]["tsb"] < 0


def test_compute_pmc_custom_tau():
    """Custom tau values should change convergence rates."""
    daily_loads = [
        (date(2026, 1, 1) + timedelta(days=i), 100.0) for i in range(30)
    ]
    # Very short tau = fast convergence
    pmc_fast = compute_pmc(daily_loads, tau_ctl=10, tau_atl=3)
    # Default tau
    pmc_default = compute_pmc(daily_loads, tau_ctl=42, tau_atl=7)

    # With shorter tau, CTL should be closer to 100 after 30 days
    assert pmc_fast[-1]["ctl"] > pmc_default[-1]["ctl"]


def test_compute_pmc_result_fields():
    """Each PMC entry should have all expected fields."""
    pmc = compute_pmc([(date(2026, 1, 1), 100.0)])
    entry = pmc[0]
    assert "date" in entry
    assert "ctl" in entry
    assert "atl" in entry
    assert "tsb" in entry
    assert "daily_load" in entry
    assert entry["date"] == date(2026, 1, 1)


def test_estimated_load_scales_with_duration():
    """Activities without EPOC should estimate load from duration, not flat 50."""
    short = compute_activity_load({"duration": 1800}, source="garmin_run")  # 30 min
    long = compute_activity_load({"duration": 5400}, source="garmin_run")   # 90 min
    assert long["load_value"] > short["load_value"]


def test_estimated_load_no_duration_fallback():
    """Activities without EPOC or duration should fall back to 50.0."""
    load = compute_activity_load({}, source="garmin_unknown")
    assert load["load_value"] == 50.0
