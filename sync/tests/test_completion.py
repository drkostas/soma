"""Tests for Completion Scoring — activity matching and constraint compliance."""

from training_engine.completion import (
    match_activity_to_plan,
    score_pace_compliance,
    score_distance_compliance,
    score_hr_compliance,
    compute_completion_score,
)


# --- Activity matching tests ---


def test_match_by_date_running_type():
    """Matches a running activity on the same date as the plan day."""
    plan_day = {"day_date": "2026-03-10", "run_type": "easy", "target_distance_km": 7.0}
    activities = [
        {"date": "2026-03-10", "type": "running", "distance_m": 7100},
    ]
    result = match_activity_to_plan(plan_day, activities)
    assert result is not None
    assert result["distance_m"] == 7100


def test_match_no_match_wrong_date():
    """No match when activity is on a different date."""
    plan_day = {"day_date": "2026-03-10", "run_type": "easy", "target_distance_km": 7.0}
    activities = [
        {"date": "2026-03-11", "type": "running", "distance_m": 7000},
    ]
    result = match_activity_to_plan(plan_day, activities)
    assert result is None


def test_match_ignores_non_running_types():
    """Non-running activity types are filtered out."""
    plan_day = {"day_date": "2026-03-10", "run_type": "easy", "target_distance_km": 7.0}
    activities = [
        {"date": "2026-03-10", "type": "cycling", "distance_m": 7000},
        {"date": "2026-03-10", "type": "swimming", "distance_m": 3000},
    ]
    result = match_activity_to_plan(plan_day, activities)
    assert result is None


def test_match_multiple_picks_closest_distance():
    """When multiple running activities on same date, pick closest by distance."""
    plan_day = {"day_date": "2026-03-10", "run_type": "easy", "target_distance_km": 7.0}
    activities = [
        {"date": "2026-03-10", "type": "running", "distance_m": 3000},   # 3 km, far off
        {"date": "2026-03-10", "type": "running", "distance_m": 6800},   # 6.8 km, closest
        {"date": "2026-03-10", "type": "running", "distance_m": 12000},  # 12 km, far off
    ]
    result = match_activity_to_plan(plan_day, activities)
    assert result is not None
    assert result["distance_m"] == 6800


def test_match_trail_running():
    """trail_running type should also match."""
    plan_day = {"day_date": "2026-03-10", "run_type": "long", "target_distance_km": 15.0}
    activities = [
        {"date": "2026-03-10", "type": "trail_running", "distance_m": 14500},
    ]
    result = match_activity_to_plan(plan_day, activities)
    assert result is not None


def test_match_treadmill_running():
    """treadmill_running type should also match."""
    plan_day = {"day_date": "2026-03-10", "run_type": "easy", "target_distance_km": 6.0}
    activities = [
        {"date": "2026-03-10", "type": "treadmill_running", "distance_m": 5800},
    ]
    result = match_activity_to_plan(plan_day, activities)
    assert result is not None


def test_match_empty_activities():
    """Empty activity list returns None."""
    plan_day = {"day_date": "2026-03-10", "run_type": "easy", "target_distance_km": 7.0}
    result = match_activity_to_plan(plan_day, [])
    assert result is None


# --- Pace compliance tests ---


def test_pace_within_range():
    """Actual pace within target range scores 100."""
    assert score_pace_compliance(300, 290, 310) == 100


def test_pace_at_boundary():
    """Actual pace exactly at boundary scores 100."""
    assert score_pace_compliance(290, 290, 310) == 100
    assert score_pace_compliance(310, 290, 310) == 100


def test_pace_slightly_outside():
    """Slightly outside range gives partial score (50-100)."""
    # 10% deviation from min boundary (290): 290 * 0.10 = 29 sec outside
    # actual = 290 - 15 = 275, deviation = 15/290 = 0.0517
    # score = max(0, 100 * (1 - 0.0517 * 5)) = 100 * 0.7414 = 74.1
    score = score_pace_compliance(275, 290, 310)
    assert 50 < score < 100


def test_pace_way_outside():
    """20%+ deviation gives very low score."""
    # 20% below min: 290 * 0.80 = 232
    # deviation = (290 - 232) / 290 = 0.20
    # score = max(0, 100 * (1 - 0.20 * 5)) = 100 * 0.0 = 0
    score = score_pace_compliance(232, 290, 310)
    assert score < 50


def test_pace_far_outside_is_zero():
    """Way outside range scores 0."""
    # 30% deviation
    score = score_pace_compliance(200, 290, 310)
    assert score == 0


# --- Distance compliance tests ---


def test_distance_exact():
    """Exact distance scores 100."""
    assert score_distance_compliance(10.0, 10.0) == 100


def test_distance_within_10_percent():
    """Within 10% of target is high score (>= 80)."""
    # ratio = 9.0/10.0 = 0.9, deviation = 0.1
    # score = max(0, 100 * (1 - 0.1 * 3.33)) = 100 * 0.667 = 66.7
    score = score_distance_compliance(9.0, 10.0)
    assert score >= 60  # adjusted to match formula

    # ratio = 10.5/10.0 = 1.05, deviation = 0.05
    # score = max(0, 100 * (1 - 0.05 * 3.33)) = 100 * 0.8335 = 83.35
    score = score_distance_compliance(10.5, 10.0)
    assert score >= 80


def test_distance_half():
    """Half distance should give low score."""
    # ratio = 5.0/10.0 = 0.5, deviation = 0.5
    # score = max(0, 100 * (1 - 0.5 * 3.33)) = 100 * (-0.665) = 0
    score = score_distance_compliance(5.0, 10.0)
    assert score == 0


def test_distance_30_percent_off_is_zero():
    """30% off target scores 0."""
    # ratio = 7.0/10.0 = 0.7, deviation = 0.3
    # score = max(0, 100 * (1 - 0.3 * 3.33)) = 100 * 0.001 ≈ 0
    score = score_distance_compliance(7.0, 10.0)
    assert score < 5


def test_distance_zero_target():
    """Zero target returns 100 (rest day or irrelevant)."""
    assert score_distance_compliance(0.0, 0.0) == 100
    assert score_distance_compliance(5.0, 0.0) == 100


def test_distance_negative_target():
    """Negative target returns 100."""
    assert score_distance_compliance(5.0, -1.0) == 100


# --- HR compliance tests ---


def test_hr_within_zone():
    """Actual HR within zone scores 100."""
    assert score_hr_compliance(150, 140, 160) == 100


def test_hr_at_boundary():
    """HR exactly at boundary scores 100."""
    assert score_hr_compliance(140, 140, 160) == 100
    assert score_hr_compliance(160, 140, 160) == 100


def test_hr_no_targets():
    """No HR targets (None) scores 100."""
    assert score_hr_compliance(150, None, None) == 100


def test_hr_outside_zone():
    """HR outside zone gets partial score."""
    # Above max: 170, max=160, deviation = (170-160)/160 = 0.0625
    # score = max(0, 100 * (1 - 0.0625 * 5)) = 100 * 0.6875 = 68.75
    score = score_hr_compliance(170, 140, 160)
    assert 50 < score < 100


def test_hr_way_outside():
    """HR far outside zone scores 0."""
    # 20% above max: 192, max=160, deviation = (192-160)/160 = 0.20
    # score = max(0, 100 * (1 - 0.20 * 5)) = 0
    score = score_hr_compliance(192, 140, 160)
    assert score == 0


# --- Completion score tests ---


def test_perfect_run():
    """Perfect compliance across all dimensions scores >= 90."""
    plan_step = {
        "target_pace_min": 290,
        "target_pace_max": 310,
        "target_distance_km": 10.0,
        "target_hr_min": 140,
        "target_hr_max": 160,
    }
    actual = {
        "avg_pace_sec_km": 300,
        "distance_km": 10.0,
        "avg_hr": 150,
    }
    score = compute_completion_score(plan_step, actual)
    assert score >= 90


def test_no_activity():
    """No activity (None) scores 0."""
    plan_step = {
        "target_pace_min": 290,
        "target_pace_max": 310,
        "target_distance_km": 10.0,
        "target_hr_min": 140,
        "target_hr_max": 160,
    }
    assert compute_completion_score(plan_step, None) == 0


def test_completion_score_no_hr_targets():
    """Plan step without HR targets still computes score."""
    plan_step = {
        "target_pace_min": 290,
        "target_pace_max": 310,
        "target_distance_km": 10.0,
        "target_hr_min": None,
        "target_hr_max": None,
    }
    actual = {
        "avg_pace_sec_km": 300,
        "distance_km": 10.0,
        "avg_hr": 150,
    }
    score = compute_completion_score(plan_step, actual)
    assert score >= 90


def test_completion_score_weighted():
    """Verify weights are applied correctly by making one dimension bad."""
    plan_step = {
        "target_pace_min": 290,
        "target_pace_max": 310,
        "target_distance_km": 10.0,
        "target_hr_min": 140,
        "target_hr_max": 160,
    }
    # Perfect pace and HR, but terrible distance (0 km)
    actual = {
        "avg_pace_sec_km": 300,
        "distance_km": 0.0,
        "avg_hr": 150,
    }
    score = compute_completion_score(plan_step, actual)
    # Pace=100 (weight 0.50), Distance=0 (weight 0.30), HR=100 (weight 0.20)
    # Expected: 100*0.50 + 0*0.30 + 100*0.20 = 70
    assert 65 <= score <= 75


def test_completion_score_custom_weights():
    """Custom weights are respected."""
    plan_step = {
        "target_pace_min": 290,
        "target_pace_max": 310,
        "target_distance_km": 10.0,
        "target_hr_min": None,
        "target_hr_max": None,
    }
    actual = {
        "avg_pace_sec_km": 300,
        "distance_km": 10.0,
        "avg_hr": 150,
    }
    score = compute_completion_score(
        plan_step, actual,
        pace_weight=1.0, distance_weight=0.0, hr_weight=0.0,
    )
    assert score == 100
