"""Tests for the 5-week half marathon training plan generator."""

from datetime import date, timedelta

from training_engine.plan_generator import (
    generate_plan,
    build_cruise_intervals_steps,
    build_easy_with_strides_steps,
    _compute_start_date,
)


# Race date: April 12, 2026 (Sunday)
RACE_DATE = date(2026, 4, 12)
PLAN = generate_plan(RACE_DATE)


def test_generate_plan_structure():
    """Plan should have 35 days (5 weeks x 7 days), correct dates, and week numbers."""
    assert PLAN["plan_name"] == "Knoxville HM 2026"
    assert PLAN["race_date"] == RACE_DATE
    assert PLAN["race_distance_km"] == 21.1
    assert PLAN["goal_time_seconds"] == 5700
    assert len(PLAN["days"]) == 35

    # Dates should be consecutive starting from Week 1 Monday
    start = _compute_start_date(RACE_DATE)
    assert start == date(2026, 3, 9)  # Monday, 5 weeks before Apr 12
    for i, day in enumerate(PLAN["days"]):
        expected_date = start + timedelta(days=i)
        assert day["day_date"] == expected_date, f"Day {i}: expected {expected_date}, got {day['day_date']}"

    # Week numbers
    for i, day in enumerate(PLAN["days"]):
        expected_week = (i // 7) + 1
        assert day["week_number"] == expected_week, f"Day {i}: expected week {expected_week}"

    # day_of_week should match actual weekday
    for day in PLAN["days"]:
        assert day["day_of_week"] == day["day_date"].weekday()


def test_week1_long_run():
    """Saturday of Week 1 should be a 15 km easy long run."""
    # Saturday = index 5 (Mon=0, Tue=1, Wed=2, Thu=3, Fri=4, Sat=5)
    sat_w1 = PLAN["days"][5]
    assert sat_w1["day_of_week"] == 5  # Saturday
    assert sat_w1["week_number"] == 1
    assert sat_w1["run_type"] == "long"
    assert sat_w1["target_distance_km"] == 15.0
    assert sat_w1["workout_steps"] is not None
    # Should be a single easy interval
    assert len(sat_w1["workout_steps"]) == 1
    step = sat_w1["workout_steps"][0]
    assert step["target_type"] == "pace"
    assert step["target_pace_min"] == 322
    assert step["target_pace_max"] == 345


def test_week3_peak_long_run():
    """Saturday of Week 3 should be 20 km with progression finish."""
    sat_w3 = PLAN["days"][2 * 7 + 5]  # Week 3 Saturday
    assert sat_w3["week_number"] == 3
    assert sat_w3["day_of_week"] == 5
    assert sat_w3["run_type"] == "long"
    assert sat_w3["target_distance_km"] == 20.0
    # Should have multiple segments (progression)
    steps = sat_w3["workout_steps"]
    assert len(steps) >= 3
    # First segment should be easy
    assert steps[0]["target_pace_min"] == 322
    # Last segment should be at T-pace (269)
    assert steps[-1]["target_pace_min"] == 269


def test_race_day():
    """April 12 should be race type."""
    race_day = PLAN["days"][-1]  # Last day
    assert race_day["day_date"] == date(2026, 4, 12)
    assert race_day["run_type"] == "race"
    assert race_day["target_distance_km"] == 21.1
    assert race_day["load_level"] == "race"
    # Race steps: warmup + race interval
    steps = race_day["workout_steps"]
    assert steps[0]["step_type"] == "warmup"
    assert steps[1]["duration_value"] == 21100  # 21.1 km in meters
    assert steps[1]["target_pace_min"] == 269  # A-goal pace (T-pace from VDOT formula)


def test_wednesday_is_rest():
    """All Wednesdays should be rest days."""
    wednesdays = [d for d in PLAN["days"] if d["day_of_week"] == 2]
    assert len(wednesdays) == 5
    # Weeks 1-3 Wednesdays are explicit REST
    for wed in wednesdays[:3]:
        assert wed["run_type"] == "rest", f"Week {wed['week_number']} Wednesday should be rest"
        assert wed["workout_steps"] is None

    # Week 4 Wednesday: easy + strides (taper changes the pattern)
    assert wednesdays[3]["week_number"] == 4
    assert wednesdays[3]["run_type"] == "easy"

    # Week 5 Wednesday: easy run
    assert wednesdays[4]["week_number"] == 5
    assert wednesdays[4]["run_type"] == "easy"


def test_cruise_intervals_steps():
    """Cruise intervals should have correct number of steps and paces."""
    steps = build_cruise_intervals_steps(
        reps=4, rep_distance_m=1600, t_pace=269, recovery_sec=90,
        wu_km=2.0, cd_km=2.0, e_pace_min=322, e_pace_max=345,
    )
    # warmup + lap-button + 4 intervals + 3 recoveries + cooldown = 10 steps
    assert len(steps) == 10

    # Warmup (HR-targeted, zone 2)
    assert steps[0]["step_type"] == "warmup"
    assert steps[0]["duration_value"] == 2000
    assert steps[0]["target_type"] == "hr"
    assert steps[0]["hr_zone"] == 2

    # Lap button
    assert steps[1]["step_type"] == "rest"
    assert steps[1]["duration_type"] == "lap_button"

    # Intervals at T-pace ± 7 sec/km
    interval_steps = [s for s in steps if s["step_type"] == "interval"]
    assert len(interval_steps) == 4
    for s in interval_steps:
        assert s["target_pace_min"] == 262  # t_pace(269) - 7
        assert s["target_pace_max"] == 276  # t_pace(269) + 7
        assert s["duration_value"] == 1600

    # Recoveries
    recovery_steps = [s for s in steps if s["step_type"] == "recovery"]
    assert len(recovery_steps) == 3
    for s in recovery_steps:
        assert s["duration_value"] == 90

    # Cooldown
    assert steps[-1]["step_type"] == "cooldown"
    assert steps[-1]["duration_value"] == 2000


def test_easy_with_strides_steps():
    """Easy + strides should have strides at R-pace."""
    steps = build_easy_with_strides_steps(
        distance_km=7.0, e_pace_min=322, e_pace_max=345,
        stride_count=6, r_pace_min=227, r_pace_max=233,
    )
    # easy portion + lap-button + 6 strides + 5 recovery jogs + 1 final cooldown = 14 steps
    assert len(steps) == 14

    # First step is easy run (HR-targeted, zone 2)
    assert steps[0]["target_type"] == "hr"
    assert steps[0]["hr_zone"] == 2

    # Stride steps should be at R-pace (time-based, 20 sec each)
    stride_steps = [s for s in steps if s["step_type"] == "interval" and "tride" in s["description"]]
    assert len(stride_steps) == 6
    for s in stride_steps:
        assert s["target_pace_min"] == 227
        assert s["target_pace_max"] == 233
        assert s["duration_value"] == 20  # 20-second strides


def test_gym_schedule():
    """Weeks 1-3: Mon=push, Tue=pull, Thu=legs, Fri=upper, Sun=lower."""
    for week_num in [1, 2, 3]:
        week_days = [d for d in PLAN["days"] if d["week_number"] == week_num]
        gym_map = {d["day_of_week"]: d["gym_workout"] for d in week_days}
        assert gym_map[0] == "push", f"Week {week_num} Mon should be push"
        assert gym_map[1] == "pull", f"Week {week_num} Tue should be pull"
        assert gym_map[3] == "legs", f"Week {week_num} Thu should be legs"
        assert gym_map[4] == "upper", f"Week {week_num} Fri should be upper"
        assert gym_map[6] == "lower", f"Week {week_num} Sun should be lower"


def test_gym_taper():
    """Weeks 4-5 should have reduced gym sessions per research."""
    # Week 4: Push (Mon), Pull (Tue), Legs lighter (Thu), skip Upper+Lower weekend
    w4_days = [d for d in PLAN["days"] if d["week_number"] == 4]
    w4_gym = {d["day_of_week"]: d["gym_workout"] for d in w4_days}
    assert w4_gym.get(0) == "push", "Week 4 Mon should have push"
    assert w4_gym.get(1) == "pull", "Week 4 Tue should still have pull"
    assert w4_gym.get(3) == "legs", "Week 4 Thu should have legs (lighter)"
    assert w4_gym.get(4) is None, "Week 4 Fri should skip upper"
    assert w4_gym.get(6) is None, "Week 4 Sun should skip lower (taper weekend)"

    # Week 5: Push (Mon), Pull (Tue), then STOP
    w5_days = [d for d in PLAN["days"] if d["week_number"] == 5]
    w5_gym = {d["day_of_week"]: d["gym_workout"] for d in w5_days}
    assert w5_gym.get(0) == "push", "Week 5 Mon should have push"
    assert w5_gym.get(1) == "pull", "Week 5 Tue should have pull"
    # No gym for rest of week 5
    assert w5_gym.get(2) is None, "Week 5 Wed should have no gym"
    assert w5_gym.get(3) is None, "Week 5 Thu should have no gym"
    assert w5_gym.get(4) is None, "Week 5 Fri should have no gym"
    assert w5_gym.get(5) is None, "Week 5 Sat should have no gym"
    assert w5_gym.get(6) is None, "Week 5 Sun (race) should have no gym"


def test_taper_volume_reduction():
    """Week 4 total distance should be less than Week 3."""
    w3_distance = sum(d["target_distance_km"] for d in PLAN["days"] if d["week_number"] == 3)
    w4_distance = sum(d["target_distance_km"] for d in PLAN["days"] if d["week_number"] == 4)
    assert w4_distance < w3_distance, (
        f"Week 4 ({w4_distance} km) should be less than Week 3 ({w3_distance} km)"
    )
    # Week 4 should be roughly 38-48 km range (added easy run on Mon per research)
    assert 35 <= w4_distance <= 50, f"Week 4 volume {w4_distance} km outside expected 35-50 range"
