"""Tests for plan adaptation logic."""
from training_engine.plan_adapter import adapt_workout


def test_green_hard_no_change():
    """Green readiness + hard workout -> keep as planned."""
    result = adapt_workout(
        run_type="tempo",
        target_distance_km=10.0,
        traffic_light="green",
        composite_z=0.5,
        tsb=5.0,
    )
    assert result["run_type"] == "tempo"
    assert result["distance_km"] == 10.0
    assert result["action"] == "as_planned"


def test_red_hard_becomes_rest():
    """Red readiness + hard workout -> rest or easy 4km."""
    result = adapt_workout(
        run_type="intervals",
        target_distance_km=9.0,
        traffic_light="red",
        composite_z=-2.0,
        tsb=-20.0,
    )
    assert result["run_type"] in ("rest", "easy")
    assert result["distance_km"] <= 4.0
    assert result["action"] == "downgrade_to_rest"


def test_red_easy_reduces():
    """Red readiness + easy workout -> reduce distance."""
    result = adapt_workout(
        run_type="easy",
        target_distance_km=7.0,
        traffic_light="red",
        composite_z=-1.5,
        tsb=-15.0,
    )
    assert result["distance_km"] <= 4.0
    assert result["action"] == "reduce"


def test_yellow_hard_swaps():
    """Yellow readiness + hard workout -> swap to easy."""
    result = adapt_workout(
        run_type="tempo",
        target_distance_km=10.0,
        traffic_light="yellow",
        composite_z=-0.8,
        tsb=-10.0,
    )
    assert result["run_type"] == "easy"
    assert result["distance_km"] < 10.0
    assert result["action"] == "swap_to_easy"


def test_yellow_easy_no_change():
    """Yellow readiness + easy workout -> keep but note caution."""
    result = adapt_workout(
        run_type="easy",
        target_distance_km=7.0,
        traffic_light="yellow",
        composite_z=-0.6,
        tsb=-5.0,
    )
    assert result["run_type"] == "easy"
    assert result["distance_km"] == 7.0
    assert result["action"] == "as_planned"


def test_rest_day_stays_rest():
    """Rest day always stays rest regardless of readiness."""
    result = adapt_workout(
        run_type="rest",
        target_distance_km=0.0,
        traffic_light="green",
        composite_z=1.0,
        tsb=10.0,
    )
    assert result["run_type"] == "rest"
    assert result["action"] == "as_planned"


def test_distance_adjustment_moderate_fatigue():
    """TSB moderately negative -> reduce distance 10%."""
    result = adapt_workout(
        run_type="easy",
        target_distance_km=7.0,
        traffic_light="green",
        composite_z=0.0,
        tsb=-16.0,
    )
    assert result["distance_km"] == 6.3  # 7.0 * 0.90
    assert result["pace_factor"] == 1.02


def test_pace_factor_returned():
    """Result includes pace_factor for adjusting workout steps."""
    result = adapt_workout(
        run_type="tempo",
        target_distance_km=10.0,
        traffic_light="green",
        composite_z=-0.3,
        tsb=-21.0,
    )
    assert "pace_factor" in result
    assert result["pace_factor"] == 1.03
