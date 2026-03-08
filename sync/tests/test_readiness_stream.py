"""Tests for Readiness Stream — z-score computation and traffic light logic."""

from training_engine.readiness_stream import z_score, compute_readiness


def test_z_score_normal():
    """Z-score computation with standard values."""
    values = [60, 62, 58, 61, 59, 63, 60, 61, 58, 62,
              60, 61, 59, 63, 60, 62, 58, 61, 60, 62,
              59, 63, 60, 61, 58, 62, 60, 61]  # 28 days
    z = z_score(55.0, values)
    assert z < -1.0  # well below baseline


def test_z_score_above_baseline():
    """Z-score for value above baseline is positive."""
    values = [60, 62, 58, 61, 59, 63, 60, 61, 58, 62,
              60, 61, 59, 63, 60, 62, 58, 61, 60, 62,
              59, 63, 60, 61, 58, 62, 60, 61]  # 28 days, mean ~60.5
    z = z_score(65.0, values)
    assert z > 0


def test_z_score_insufficient_data():
    """Returns 0 with < 7 values."""
    z = z_score(60.0, [55, 58, 60])
    assert z == 0.0


def test_z_score_zero_std():
    """Returns 0 when all values are identical."""
    z = z_score(60.0, [60.0] * 28)
    assert z == 0.0


def test_z_score_at_mean():
    """Value at the mean produces z-score of 0."""
    values = [60, 62, 58, 61, 59, 63, 60]
    mean = sum(values) / len(values)
    z = z_score(mean, values)
    assert abs(z) < 0.01


def test_hard_override_sleep_under_5h():
    """Sleep < 5h triggers RED."""
    signals = {
        "hrv_z": 0.5, "sleep_z": -3.0, "rhr_z": 0.0, "bb_z": 0.2,
        "sleep_hours": 4.5,
    }
    result = compute_readiness(signals)
    assert result["traffic_light"] == "red"
    assert "sleep_under_5h" in result["flags"]


def test_hard_override_low_body_battery():
    """Body battery < 25 triggers RED."""
    signals = {
        "hrv_z": 0.5, "sleep_z": 0.0, "rhr_z": 0.0, "bb_z": -2.0,
        "sleep_hours": 7.0, "body_battery_morning": 20,
    }
    result = compute_readiness(signals)
    assert result["traffic_light"] == "red"
    assert "body_battery_critical" in result["flags"]


def test_hard_override_both():
    """Both hard overrides trigger RED with both flags."""
    signals = {
        "hrv_z": 0.5, "sleep_z": -3.0, "rhr_z": 0.0, "bb_z": -2.0,
        "sleep_hours": 4.0, "body_battery_morning": 15,
    }
    result = compute_readiness(signals)
    assert result["traffic_light"] == "red"
    assert "sleep_under_5h" in result["flags"]
    assert "body_battery_critical" in result["flags"]


def test_majority_rule_yellow():
    """2 of 4 signals flagged (z < -1) = YELLOW."""
    signals = {
        "hrv_z": -1.5, "sleep_z": -0.2, "rhr_z": -1.8, "bb_z": 0.1,
        "sleep_hours": 7.0,
    }
    result = compute_readiness(signals)
    assert result["traffic_light"] == "yellow"
    assert "2_of_4_flagged" in result["flags"]


def test_majority_rule_red():
    """3 of 4 signals flagged = RED."""
    signals = {
        "hrv_z": -1.5, "sleep_z": -1.2, "rhr_z": -1.8, "bb_z": 0.1,
        "sleep_hours": 6.0,
    }
    result = compute_readiness(signals)
    assert result["traffic_light"] == "red"
    assert "3_of_4_flagged" in result["flags"]


def test_majority_rule_all_four_flagged():
    """4 of 4 signals flagged = RED."""
    signals = {
        "hrv_z": -1.5, "sleep_z": -1.2, "rhr_z": -1.8, "bb_z": -2.0,
        "sleep_hours": 6.0,
    }
    result = compute_readiness(signals)
    assert result["traffic_light"] == "red"
    assert "3_of_4_flagged" in result["flags"]


def test_all_green():
    """All signals normal = GREEN."""
    signals = {
        "hrv_z": 0.5, "sleep_z": 0.3, "rhr_z": 0.0, "bb_z": 0.2,
        "sleep_hours": 7.5,
    }
    result = compute_readiness(signals)
    assert result["traffic_light"] == "green"
    assert result["flags"] == []


def test_equal_weights_composite():
    """Equal-weight composite score = mean of all 4 z-scores."""
    signals = {
        "hrv_z": 1.0, "sleep_z": 0.5, "rhr_z": -0.5, "bb_z": 0.0,
        "sleep_hours": 7.5,
    }
    result = compute_readiness(signals)
    assert abs(result["composite_score"] - 0.25) < 0.01


def test_result_has_all_fields():
    """Result dict has all required fields."""
    signals = {"hrv_z": 0.0, "sleep_z": 0.0, "rhr_z": 0.0, "bb_z": 0.0, "sleep_hours": 7.0}
    result = compute_readiness(signals)
    assert "hrv_z_score" in result
    assert "sleep_z_score" in result
    assert "rhr_z_score" in result
    assert "body_battery_z_score" in result
    assert "composite_score" in result
    assert "traffic_light" in result
    assert "flags" in result


def test_body_battery_morning_optional():
    """body_battery_morning is optional; no override when missing."""
    signals = {
        "hrv_z": 0.0, "sleep_z": 0.0, "rhr_z": 0.0, "bb_z": -2.0,
        "sleep_hours": 7.0,
    }
    result = compute_readiness(signals)
    # Without body_battery_morning, no body_battery_critical flag
    assert "body_battery_critical" not in result["flags"]


def test_one_signal_flagged_stays_green():
    """Only 1 of 4 flagged stays GREEN (but HRV SWC flag still fires)."""
    signals = {
        "hrv_z": -1.5, "sleep_z": 0.5, "rhr_z": 0.3, "bb_z": 0.2,
        "sleep_hours": 7.0,
    }
    result = compute_readiness(signals)
    assert result["traffic_light"] == "green"
    assert "hrv_below_swc" in result["flags"]


def test_sleep_exactly_5h_is_green():
    """Sleep == 5h does not trigger hard override (only < 5h does)."""
    signals = {
        "hrv_z": 0.5, "sleep_z": -0.5, "rhr_z": 0.0, "bb_z": 0.2,
        "sleep_hours": 5.0,
    }
    result = compute_readiness(signals)
    assert "sleep_under_5h" not in result["flags"]


def test_body_battery_exactly_25_is_not_critical():
    """Body battery == 25 does not trigger hard override (only < 25 does)."""
    signals = {
        "hrv_z": 0.5, "sleep_z": 0.0, "rhr_z": 0.0, "bb_z": 0.0,
        "sleep_hours": 7.0, "body_battery_morning": 25,
    }
    result = compute_readiness(signals)
    assert "body_battery_critical" not in result["flags"]


def test_hrv_swc_override():
    """HRV z < -0.5 (1 SWC below baseline) should trigger flag."""
    signals = {
        "hrv_z": -0.6,
        "sleep_z": 0.5,
        "rhr_z": 0.5,
        "bb_z": 0.5,
        "sleep_hours": 8.0,
    }
    result = compute_readiness(signals)
    assert "hrv_below_swc" in result["flags"]


def test_hrv_above_swc_no_flag():
    """HRV z = -0.4 should NOT trigger SWC flag."""
    signals = {
        "hrv_z": -0.4,
        "sleep_z": 0.5,
        "rhr_z": 0.5,
        "bb_z": 0.5,
        "sleep_hours": 8.0,
    }
    result = compute_readiness(signals)
    assert "hrv_below_swc" not in result["flags"]


def test_null_signals_return_none_z_scores():
    """When a signal is None, z-score should be None not 0.0."""
    signals = {
        "hrv_z": None,
        "sleep_z": None,
        "rhr_z": 1.5,
        "bb_z": None,
        "sleep_hours": 8.0,
        "body_battery_morning": None,
    }
    result = compute_readiness(signals)
    assert result["hrv_z_score"] is None
    assert result["sleep_z_score"] is None
    assert result["rhr_z_score"] == 1.5
    assert result["body_battery_z_score"] is None
    # Composite should only average non-None signals
    assert result["composite_score"] == 1.5  # only RHR contributes
