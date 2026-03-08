"""Tests for Merge Function — combines all training engine streams into outputs."""

from training_engine.merge import (
    compute_adjusted_pace,
    fatigue_factor,
    merge,
    readiness_factor,
)


# --- readiness_factor tests ---


def test_readiness_factor_high():
    """z > 1 -> 0.97 (3% faster)."""
    assert readiness_factor(1.5) == 0.97


def test_readiness_factor_normal():
    """z = 0 -> 1.00."""
    assert readiness_factor(0.0) == 1.0


def test_readiness_factor_low():
    """z < -1 -> 1.05 (5% slower)."""
    assert readiness_factor(-1.5) == 1.05


def test_readiness_factor_rest():
    """z < -2 -> REST signal."""
    assert readiness_factor(-2.5) == -1.0


def test_readiness_factor_exactly_minus_2():
    """z == -2 is the REST boundary."""
    assert readiness_factor(-2.0) == -1.0


def test_readiness_factor_exactly_minus_1():
    """z == -1 -> 1.05."""
    assert readiness_factor(-1.0) == 1.05


def test_readiness_factor_exactly_plus_1():
    """z == +1 -> 0.97."""
    assert readiness_factor(1.0) == 0.97


def test_readiness_factor_interpolation_positive():
    """Linear interpolation between z=0 (1.00) and z=1 (0.97)."""
    f = readiness_factor(0.5)
    assert 0.97 < f < 1.00  # between 0.97 and 1.00
    assert abs(f - 0.985) < 0.001  # 1.00 - 0.03*0.5 = 0.985


def test_readiness_factor_interpolation_negative():
    """Linear interpolation between z=-1 (1.05) and z=0 (1.00)."""
    f = readiness_factor(-0.5)
    assert 1.00 < f < 1.05  # between 1.00 and 1.05
    assert abs(f - 1.025) < 0.001  # 1.00 - 0.05*(-0.5) = 1.025


# --- fatigue_factor tests ---


def test_fatigue_factor_fresh():
    """TSB > 10 -> 0.98."""
    assert fatigue_factor(15) == 0.98


def test_fatigue_factor_neutral():
    """TSB = 0 -> 1.00."""
    assert fatigue_factor(0) == 1.0


def test_fatigue_factor_fatigued():
    """TSB < -20 -> 1.03."""
    assert fatigue_factor(-25) == 1.03


def test_fatigue_factor_exactly_plus_10():
    """TSB == 10 -> 0.98."""
    assert fatigue_factor(10) == 0.98


def test_fatigue_factor_exactly_minus_20():
    """TSB == -20 -> 1.03."""
    assert fatigue_factor(-20) == 1.03


def test_fatigue_factor_interpolation_negative():
    """Linear interpolation between TSB=0 (1.00) and TSB=-20 (1.03)."""
    f = fatigue_factor(-10)
    assert 1.00 < f < 1.03
    assert abs(f - 1.015) < 0.001  # 1.00 - 0.0015*(-10) = 1.015


def test_fatigue_factor_interpolation_positive():
    """Linear interpolation between TSB=0 (1.00) and TSB=10 (0.98)."""
    f = fatigue_factor(5)
    assert 0.98 < f < 1.00
    assert abs(f - 0.99) < 0.001  # 1.00 - 0.002*5 = 0.99


# --- compute_adjusted_pace tests ---


def test_adjusted_pace_normal():
    """Normal readiness and fatigue -> no adjustment."""
    pace = compute_adjusted_pace(284, readiness_z=0.0, tsb=0.0)
    assert pace == 284  # no adjustment


def test_adjusted_pace_all_factors():
    """All factors active: readiness slightly negative, TSB negative, weight factor."""
    pace = compute_adjusted_pace(284, readiness_z=-0.5, tsb=-10, weight_factor=0.994)
    # readiness_z=-0.5 -> readiness_factor = 1.025
    # tsb=-10 -> fatigue_factor = 1.015
    # weight = 0.994
    # 284 * 1.025 * 1.015 * 0.994 = ~293.6
    assert 288 < pace < 298


def test_adjusted_pace_rest():
    """Very low readiness -> REST (None)."""
    pace = compute_adjusted_pace(284, readiness_z=-2.5, tsb=0.0)
    assert pace is None


def test_adjusted_pace_fresh_and_ready():
    """High readiness + fresh -> faster pace."""
    pace = compute_adjusted_pace(284, readiness_z=1.5, tsb=15)
    # 0.97 * 0.98 = 0.9506 -> 284 * 0.9506 = ~270
    assert pace < 284


def test_adjusted_pace_weight_factor():
    """Weight factor alone."""
    # Lighter (lost weight) -> faster
    pace = compute_adjusted_pace(284, readiness_z=0.0, tsb=0.0, weight_factor=0.99)
    assert pace < 284
    # Heavier (gained weight) -> slower
    pace = compute_adjusted_pace(284, readiness_z=0.0, tsb=0.0, weight_factor=1.01)
    assert pace > 284


# --- merge tests ---


def test_merge_all_streams():
    """Full merge with all streams providing data."""
    result = merge(
        load={"ctl": 45, "atl": 60, "tsb": -15},
        readiness={"composite_score": 0.3, "traffic_light": "green"},
        fitness={"vo2max": 50, "decoupling_pct": 3.2},
        body_comp={"weight_ema": 80.2, "vdot_adjusted": 47.2},
    )
    assert "adjusted_pace" in result
    assert "traffic_light" in result
    assert result["traffic_light"] == "green"
    assert result["tsb"] == -15
    assert result["vo2max"] == 50
    assert result["vdot_adjusted"] == 47.2
    assert result["weight_ema"] == 80.2
    assert result["adjusted_pace"] is not None
    assert result["adjusted_pace"] > 284  # negative TSB -> slower


def test_merge_rest_day():
    """Very low readiness -> REST day."""
    result = merge(
        load={"ctl": 30, "atl": 70, "tsb": -40},
        readiness={"composite_score": -2.5, "traffic_light": "red"},
        fitness={"vo2max": 48, "decoupling_pct": 8.0},
        body_comp={"weight_ema": 81.0, "vdot_adjusted": 46.5},
    )
    assert result["adjusted_pace"] is None  # REST
    assert result["traffic_light"] == "red"


def test_merge_fitness_trajectory():
    """Merge includes fitness trajectory summary."""
    result = merge(
        load={"ctl": 45, "atl": 60, "tsb": -15},
        readiness={"composite_score": 0.0, "traffic_light": "green"},
        fitness={"vo2max": 50, "decoupling_pct": 3.2},
        body_comp={"weight_ema": 80.0, "vdot_adjusted": 47.0},
    )
    ft = result["fitness_trajectory"]
    assert ft["ctl"] == 45
    assert ft["atl"] == 60
    assert ft["decoupling_pct"] == 3.2
    assert ft["aerobic_base"] == "adequate"  # 3% < decoupling < 5%


def test_merge_aerobic_base_developing():
    """High decoupling -> developing aerobic base."""
    result = merge(
        load={"ctl": 30, "atl": 40, "tsb": -10},
        readiness={"composite_score": 0.0, "traffic_light": "green"},
        fitness={"vo2max": 48, "decoupling_pct": 7.5},
        body_comp={"weight_ema": 80.0, "vdot_adjusted": 46.0},
    )
    assert result["fitness_trajectory"]["aerobic_base"] == "developing"


def test_merge_missing_decoupling():
    """No decoupling data -> aerobic base is None."""
    result = merge(
        load={"ctl": 30, "atl": 40, "tsb": -10},
        readiness={"composite_score": 0.0, "traffic_light": "green"},
        fitness={"vo2max": 48, "decoupling_pct": None},
        body_comp={"weight_ema": 80.0, "vdot_adjusted": 46.0},
    )
    assert result["fitness_trajectory"]["aerobic_base"] is None


def test_merge_yellow_light():
    """Yellow traffic light passes through."""
    result = merge(
        load={"ctl": 35, "atl": 50, "tsb": -15},
        readiness={"composite_score": -0.8, "traffic_light": "yellow"},
        fitness={"vo2max": 49, "decoupling_pct": 4.0},
        body_comp={"weight_ema": 80.5, "vdot_adjusted": 46.8},
    )
    assert result["traffic_light"] == "yellow"
    assert result["adjusted_pace"] is not None  # not REST, just cautious


def test_merge_readiness_and_fatigue_factors_present():
    """Merge result includes the raw readiness_factor and fatigue_factor values."""
    result = merge(
        load={"ctl": 45, "atl": 60, "tsb": -15},
        readiness={"composite_score": 0.5, "traffic_light": "green"},
        fitness={"vo2max": 50, "decoupling_pct": 3.0},
        body_comp={"weight_ema": 80.0, "vdot_adjusted": 47.0},
    )
    assert "readiness_factor" in result
    assert "fatigue_factor" in result
    assert 0.97 <= result["readiness_factor"] <= 1.05
    assert 0.98 <= result["fatigue_factor"] <= 1.03


def test_merge_applies_weight_factor():
    """Weight factor from body_comp should affect adjusted_pace."""
    result_lighter = merge(
        load={"ctl": 50, "atl": 50, "tsb": 0},
        readiness={"composite_score": 0.0, "traffic_light": "green"},
        fitness={"vo2max": 50, "decoupling_pct": 3.0},
        body_comp={"weight_ema": 79.0, "vdot_adjusted": 47.5,
                   "calibration_weight_kg": 80.5},
    )
    result_heavier = merge(
        load={"ctl": 50, "atl": 50, "tsb": 0},
        readiness={"composite_score": 0.0, "traffic_light": "green"},
        fitness={"vo2max": 50, "decoupling_pct": 3.0},
        body_comp={"weight_ema": 82.0, "vdot_adjusted": 46.5,
                   "calibration_weight_kg": 80.5},
    )
    # Lighter athlete should have faster (lower) adjusted pace
    assert result_lighter["adjusted_pace"] < result_heavier["adjusted_pace"]


def test_merge_decoupling_excellent():
    """Decoupling < 3% = excellent aerobic base."""
    result = merge(
        load={"ctl": 45, "atl": 60, "tsb": -15},
        readiness={"composite_score": 0.0, "traffic_light": "green"},
        fitness={"vo2max": 50, "decoupling_pct": 2.5},
        body_comp={"weight_ema": 80.0, "vdot_adjusted": 47.0},
    )
    assert result["fitness_trajectory"]["aerobic_base"] == "excellent"


# --- slider_factor tests ---


def test_adjusted_pace_with_slider():
    """Slider > 1 should push pace faster (lower sec/km)."""
    pace_default = compute_adjusted_pace(284, readiness_z=0.0, tsb=0.0, slider_factor=1.0)
    pace_aggressive = compute_adjusted_pace(284, readiness_z=0.0, tsb=0.0, slider_factor=1.2)
    assert pace_default == 284
    assert pace_aggressive == 284  # at z=0, tsb=0 there's no delta to scale


def test_adjusted_pace_slider_amplifies_improvement():
    """Slider > 1 amplifies pace improvement when factors make you faster."""
    pace_normal = compute_adjusted_pace(284, readiness_z=1.0, tsb=10.0, slider_factor=1.0)
    pace_aggressive = compute_adjusted_pace(284, readiness_z=1.0, tsb=10.0, slider_factor=1.5)
    # Both should be faster than base, but aggressive more so
    assert pace_normal < 284
    assert pace_aggressive < pace_normal


def test_adjusted_pace_slider_dampens():
    """Slider < 1 dampens the adjustment toward conservative."""
    pace_normal = compute_adjusted_pace(284, readiness_z=0.5, tsb=5.0, slider_factor=1.0)
    pace_conservative = compute_adjusted_pace(284, readiness_z=0.5, tsb=5.0, slider_factor=0.5)
    assert pace_conservative > pace_normal  # less improvement applied
    assert pace_conservative < 284  # still faster than base since factors are positive


def test_merge_includes_slider_factor():
    """Merge should accept and apply slider_factor."""
    result = merge(
        load={"ctl": 50, "atl": 50, "tsb": 0},
        readiness={"composite_score": 0.5, "traffic_light": "green"},
        fitness={"vo2max": 50, "decoupling_pct": 3.0},
        body_comp={"weight_ema": 80.0, "vdot_adjusted": 47.0},
        slider_factor=1.3,
    )
    assert "slider_factor" in result
    assert result["slider_factor"] == 1.3
    # With positive readiness z, slider > 1 should push pace even faster
    result_no_slider = merge(
        load={"ctl": 50, "atl": 50, "tsb": 0},
        readiness={"composite_score": 0.5, "traffic_light": "green"},
        fitness={"vo2max": 50, "decoupling_pct": 3.0},
        body_comp={"weight_ema": 80.0, "vdot_adjusted": 47.0},
    )
    assert result["adjusted_pace"] < result_no_slider["adjusted_pace"]
