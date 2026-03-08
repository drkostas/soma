"""5-week half marathon training plan generator.

Generates a Daniels-based training plan with Garmin-compatible workout steps.
The plan is a hardcoded 5-week template instantiated with specific dates and paces
derived from the athlete's VDOT.
"""

import json
from datetime import date, timedelta

from training_engine.vdot import all_paces, hm_goal_paces


# ===============================
# WORKOUT STEP BUILDERS
# ===============================

def _step(step_type, duration_type, duration_value, target_type="open",
          target_pace_min=None, target_pace_max=None, description=""):
    """Build a single workout step dict."""
    s = {
        "step_type": step_type,
        "duration_type": duration_type,
        "duration_value": duration_value,
        "target_type": target_type,
        "description": description,
    }
    if target_type == "pace" and target_pace_min is not None:
        s["target_pace_min"] = target_pace_min
        s["target_pace_max"] = target_pace_max
    return s


def _warmup(distance_m, e_pace_min, e_pace_max):
    return _step("warmup", "distance", distance_m, "pace", e_pace_min, e_pace_max, "Easy warmup")


def _cooldown(distance_m, e_pace_min, e_pace_max):
    return _step("cooldown", "distance", distance_m, "pace", e_pace_min, e_pace_max, "Easy cooldown")


def _recovery_jog(duration_sec):
    return _step("recovery", "time", duration_sec, "open", description="Recovery jog")


def _recovery_jog_distance(distance_m):
    return _step("recovery", "distance", distance_m, "open", description="Recovery jog")


def build_easy_run_steps(distance_km, e_pace_min, e_pace_max):
    """Simple easy run."""
    return [
        _step("interval", "distance", int(distance_km * 1000), "pace",
              e_pace_min, e_pace_max, f"Easy {distance_km} km"),
    ]


def build_easy_with_strides_steps(distance_km, e_pace_min, e_pace_max, stride_count, r_pace_min, r_pace_max):
    """Easy run followed by strides at R-pace with 100m recovery jog."""
    easy_distance = distance_km * 1000 - stride_count * 200  # subtract stride + recovery distance
    steps = [
        _step("interval", "distance", int(easy_distance), "pace",
              e_pace_min, e_pace_max, f"Easy run"),
    ]
    for i in range(stride_count):
        steps.append(
            _step("interval", "distance", 100, "pace",
                  r_pace_min, r_pace_max, f"Stride {i+1}/{stride_count}")
        )
        if i < stride_count - 1:
            steps.append(_recovery_jog_distance(100))
        else:
            # Last stride: 100m easy jog to finish
            steps.append(
                _step("cooldown", "distance", 100, "open", description="Easy jog to finish")
            )
    return steps


def build_cruise_intervals_steps(reps, rep_distance_m, t_pace, recovery_sec,
                                 wu_km, cd_km, e_pace_min, e_pace_max):
    """Warmup + cruise intervals at T-pace + cooldown."""
    steps = [_warmup(int(wu_km * 1000), e_pace_min, e_pace_max)]
    for i in range(reps):
        steps.append(
            _step("interval", "distance", rep_distance_m, "pace",
                  t_pace, t_pace, f"Cruise interval {i+1}/{reps} @ T-pace")
        )
        if i < reps - 1:
            steps.append(_recovery_jog(recovery_sec))
    steps.append(_cooldown(int(cd_km * 1000), e_pace_min, e_pace_max))
    return steps


def build_vo2max_intervals_steps(reps, rep_distance_m, i_pace, recovery_sec,
                                 wu_km, cd_km, e_pace_min, e_pace_max):
    """Warmup + VO2max intervals at I-pace + cooldown."""
    steps = [_warmup(int(wu_km * 1000), e_pace_min, e_pace_max)]
    for i in range(reps):
        steps.append(
            _step("interval", "distance", rep_distance_m, "pace",
                  i_pace, i_pace, f"VO2max interval {i+1}/{reps} @ I-pace")
        )
        if i < reps - 1:
            steps.append(_recovery_jog(recovery_sec))
    steps.append(_cooldown(int(cd_km * 1000), e_pace_min, e_pace_max))
    return steps


def build_hm_tempo_steps(tempo_distance_km, tempo_pace, wu_km, cd_km,
                         e_pace_min, e_pace_max):
    """Warmup + continuous tempo at HM pace + cooldown."""
    steps = [
        _warmup(int(wu_km * 1000), e_pace_min, e_pace_max),
        _step("interval", "distance", int(tempo_distance_km * 1000), "pace",
              tempo_pace, tempo_pace, f"{tempo_distance_km} km continuous @ HM pace"),
        _cooldown(int(cd_km * 1000), e_pace_min, e_pace_max),
    ]
    return steps


def build_hm_pace_intervals_steps(reps, rep_distance_m, hm_pace, recovery_sec,
                                  wu_km, cd_km, e_pace_min, e_pace_max):
    """Warmup + HM-pace reps + cooldown."""
    steps = [_warmup(int(wu_km * 1000), e_pace_min, e_pace_max)]
    for i in range(reps):
        steps.append(
            _step("interval", "distance", rep_distance_m, "pace",
                  hm_pace, hm_pace, f"HM-pace rep {i+1}/{reps}")
        )
        if i < reps - 1:
            steps.append(_recovery_jog(recovery_sec))
    steps.append(_cooldown(int(cd_km * 1000), e_pace_min, e_pace_max))
    return steps


def build_long_run_steps(distance_km, e_pace_min, e_pace_max,
                         fast_finish_km=0, fast_finish_pace_min=None, fast_finish_pace_max=None):
    """Long run with optional fast finish."""
    if fast_finish_km > 0 and fast_finish_pace_min is not None:
        easy_km = distance_km - fast_finish_km
        return [
            _step("interval", "distance", int(easy_km * 1000), "pace",
                  e_pace_min, e_pace_max, f"Easy {easy_km} km"),
            _step("interval", "distance", int(fast_finish_km * 1000), "pace",
                  fast_finish_pace_min, fast_finish_pace_max,
                  f"Fast finish {fast_finish_km} km"),
        ]
    return [
        _step("interval", "distance", int(distance_km * 1000), "pace",
              e_pace_min, e_pace_max, f"Long run {distance_km} km"),
    ]


def build_progression_long_run_steps(segments):
    """Long run with progression segments. Each segment: (km, pace_min, pace_max, description)."""
    steps = []
    for km, pace_min, pace_max, desc in segments:
        steps.append(
            _step("interval", "distance", int(km * 1000), "pace",
                  pace_min, pace_max, desc)
        )
    return steps


def build_threshold_plus_speed_steps(t_reps, t_distance_m, t_pace, t_recovery_sec,
                                     r_reps, r_distance_m, r_pace_min, r_pace_max, r_recovery_m,
                                     wu_km, cd_km, e_pace_min, e_pace_max):
    """Week 2 Thursday combo: threshold intervals + speed reps."""
    steps = [_warmup(int(wu_km * 1000), e_pace_min, e_pace_max)]
    # Threshold portion
    for i in range(t_reps):
        steps.append(
            _step("interval", "distance", t_distance_m, "pace",
                  t_pace, t_pace, f"Threshold {i+1}/{t_reps} @ T-pace")
        )
        if i < t_reps - 1:
            steps.append(_recovery_jog(t_recovery_sec))
    # Transition jog
    steps.append(_recovery_jog(120))
    # Speed reps
    for i in range(r_reps):
        steps.append(
            _step("interval", "distance", r_distance_m, "pace",
                  r_pace_min, r_pace_max, f"Speed rep {i+1}/{r_reps} @ R-pace")
        )
        if i < r_reps - 1:
            steps.append(_recovery_jog_distance(r_recovery_m))
    steps.append(_cooldown(int(cd_km * 1000), e_pace_min, e_pace_max))
    return steps


def build_sharpener_steps(reps, rep_distance_m, pace, recovery_sec,
                          wu_km, cd_km, e_pace_min, e_pace_max, description="Sharpener"):
    """Taper quality session: warmup + reps at goal pace + cooldown."""
    steps = [_warmup(int(wu_km * 1000), e_pace_min, e_pace_max)]
    for i in range(reps):
        steps.append(
            _step("interval", "distance", rep_distance_m, "pace",
                  pace, pace, f"{description} {i+1}/{reps}")
        )
        if i < reps - 1:
            steps.append(_recovery_jog(recovery_sec))
    steps.append(_cooldown(int(cd_km * 1000), e_pace_min, e_pace_max))
    return steps


def build_final_sharpener_steps(wu_km, reps_800, pace_800, stride_count,
                                r_pace_min, r_pace_max, cd_km, e_pace_min, e_pace_max):
    """Race week final sharpener: WU + 800m reps + strides + CD."""
    steps = [_warmup(int(wu_km * 1000), e_pace_min, e_pace_max)]
    for i in range(reps_800):
        steps.append(
            _step("interval", "distance", 800, "pace",
                  pace_800, pace_800, f"800m rep {i+1}/{reps_800} @ HM pace")
        )
        if i < reps_800 - 1:
            steps.append(_recovery_jog(120))
    # Transition
    steps.append(_recovery_jog(90))
    # Strides
    for i in range(stride_count):
        steps.append(
            _step("interval", "distance", 100, "pace",
                  r_pace_min, r_pace_max, f"Stride {i+1}/{stride_count}")
        )
        if i < stride_count - 1:
            steps.append(_recovery_jog_distance(100))
    steps.append(_cooldown(int(cd_km * 1000), e_pace_min, e_pace_max))
    return steps


def build_race_steps(distance_km, goal_pace):
    """Race day workout."""
    return [
        _step("warmup", "distance", 2000, "open", description="Pre-race warmup"),
        _step("interval", "distance", int(distance_km * 1000), "pace",
              goal_pace, goal_pace, f"RACE {distance_km} km"),
    ]


def build_shakeout_steps(distance_km, e_pace_min, e_pace_max, pickup_count=3):
    """Race week shakeout: easy jog with short pickups."""
    # Easy portion minus pickups
    steps = [
        _step("interval", "distance", int(distance_km * 1000 - pickup_count * 100), "pace",
              e_pace_min, e_pace_max, f"Easy shakeout"),
    ]
    for i in range(pickup_count):
        steps.append(
            _step("interval", "time", 15, "open",
                  description=f"Pickup {i+1}/{pickup_count} (15s)")
        )
    return steps


def build_rest_day():
    """Rest day - no workout steps."""
    return None


# ===============================
# PLAN GENERATOR
# ===============================

def _compute_start_date(race_date: date) -> date:
    """Compute the Monday that starts Week 1 (5 weeks before race Sunday).

    Race day is always a Sunday (day_of_week=6). Week 5 ends on race day.
    Week 1 starts 4 Mondays before race week Monday.
    """
    # Race week Monday = race_date - 6 days (Sunday -> Monday)
    race_week_monday = race_date - timedelta(days=6)
    # Go back 4 more weeks to get Week 1 Monday
    week1_monday = race_week_monday - timedelta(weeks=4)
    return week1_monday


def _day(day_date, week_number, run_type, run_title, run_description,
         target_distance_km, workout_steps, gym_workout=None, gym_notes=None,
         load_level="easy", target_duration_min=None):
    """Build a single plan day dict."""
    return {
        "day_date": day_date,
        "week_number": week_number,
        "day_of_week": day_date.weekday(),
        "run_type": run_type,
        "run_title": run_title,
        "run_description": run_description,
        "target_distance_km": target_distance_km,
        "target_duration_min": target_duration_min,
        "workout_steps": workout_steps,
        "gym_workout": gym_workout,
        "gym_notes": gym_notes,
        "load_level": load_level,
    }


def generate_plan(
    race_date: date,
    race_distance_km: float = 21.1,
    goal_time_seconds: int = 5700,
    vdot: int = 47,
    current_longest_run_km: float = 12.0,
) -> dict:
    """Generate a 5-week half marathon training plan.

    Args:
        race_date: Race day (must be a Sunday).
        race_distance_km: Race distance in km.
        goal_time_seconds: A-goal time in seconds (e.g. 5700 = 1:35).
        vdot: Athlete's VDOT score.
        current_longest_run_km: Current longest run in km.

    Returns:
        Plan dict with plan metadata and list of day dicts.
    """
    paces = all_paces(vdot)
    goals = hm_goal_paces(vdot)

    e_min, e_max = paces["E"]
    t_pace = paces["T"][0]
    i_pace = paces["I"][0]
    r_min, r_max = paces["R"]
    b_goal = goals["B"]
    a_goal = goals["A"]
    c_goal = goals["C"]

    start = _compute_start_date(race_date)
    days = []

    # ===== WEEK 1: Foundation + Distance Extension =====
    w1_mon = start
    days.append(_day(
        w1_mon, 1, "easy", "Easy Run + Strides",
        "Easy 7 km with 6x100m strides at R-pace",
        7.0,
        build_easy_with_strides_steps(7.0, e_min, e_max, 6, r_min, r_max),
        gym_workout="push", gym_notes="Full session",
    ))
    days.append(_day(
        w1_mon + timedelta(days=1), 1, "tempo", "Cruise Intervals",
        "WU 2km, 4x1600m @ T-pace (269 sec/km) w/90s jog, CD 2km",
        10.4,
        build_cruise_intervals_steps(4, 1600, t_pace, 90, 2.0, 2.0, e_min, e_max),
        gym_workout="pull", gym_notes="Full session",
        load_level="hard",
    ))
    days.append(_day(
        w1_mon + timedelta(days=2), 1, "rest", "REST",
        "Complete rest day",
        0.0, build_rest_day(),
    ))
    days.append(_day(
        w1_mon + timedelta(days=3), 1, "intervals", "VO2max Intervals",
        "WU 2km, 5x1000m @ I-pace (249 sec/km) w/3min jog, CD 2km",
        9.0,
        build_vo2max_intervals_steps(5, 1000, i_pace, 180, 2.0, 2.0, e_min, e_max),
        gym_workout="legs", gym_notes="Full session",
        load_level="hard",
    ))
    days.append(_day(
        w1_mon + timedelta(days=4), 1, "easy", "Easy Run + Strides",
        "Easy 6 km with 6x100m strides at R-pace",
        6.0,
        build_easy_with_strides_steps(6.0, e_min, e_max, 6, r_min, r_max),
        gym_workout="upper", gym_notes="Full session",
    ))
    days.append(_day(
        w1_mon + timedelta(days=5), 1, "long", "Long Run",
        "Long Run 15 km @ E-pace",
        15.0,
        build_long_run_steps(15.0, e_min, e_max),
        load_level="moderate",
    ))
    days.append(_day(
        w1_mon + timedelta(days=6), 1, "easy", "Rest or Easy",
        "Rest or easy 4 km",
        4.0,
        build_easy_run_steps(4.0, e_min, e_max),
        gym_workout="lower", gym_notes="Full session",
    ))

    # ===== WEEK 2: Building Specificity =====
    w2_mon = start + timedelta(weeks=1)
    days.append(_day(
        w2_mon, 2, "easy", "Easy Run + Strides",
        "Easy 7 km with 6x100m strides at R-pace",
        7.0,
        build_easy_with_strides_steps(7.0, e_min, e_max, 6, r_min, r_max),
        gym_workout="push", gym_notes="Full session",
    ))
    days.append(_day(
        w2_mon + timedelta(days=1), 2, "tempo", "HM-Pace Tempo",
        "WU 2km, 3x2km @ B-goal (284 sec/km) w/2min jog, CD 2km",
        10.0,
        build_hm_pace_intervals_steps(3, 2000, b_goal, 120, 2.0, 2.0, e_min, e_max),
        gym_workout="pull", gym_notes="Full session",
        load_level="hard",
    ))
    days.append(_day(
        w2_mon + timedelta(days=2), 2, "rest", "REST",
        "Complete rest day",
        0.0, build_rest_day(),
    ))
    days.append(_day(
        w2_mon + timedelta(days=3), 2, "intervals", "Threshold + Speed",
        "WU 2km, 3x1600m @ T-pace w/90s jog, 4x200m @ R-pace w/200m jog, CD 1km",
        9.4,
        build_threshold_plus_speed_steps(
            3, 1600, t_pace, 90,
            4, 200, r_min, r_max, 200,
            2.0, 1.0, e_min, e_max,
        ),
        gym_workout="legs", gym_notes="Full session",
        load_level="hard",
    ))
    days.append(_day(
        w2_mon + timedelta(days=4), 2, "easy", "Easy Run + Strides",
        "Easy 6 km with 6x100m strides at R-pace",
        6.0,
        build_easy_with_strides_steps(6.0, e_min, e_max, 6, r_min, r_max),
        gym_workout="upper", gym_notes="Full session",
    ))
    days.append(_day(
        w2_mon + timedelta(days=5), 2, "long", "Long Run (Fast Finish)",
        "18 km: 15 km @ E-pace, final 3 km @ 290-295 sec/km. Practice gel.",
        18.0,
        build_long_run_steps(18.0, e_min, e_max,
                             fast_finish_km=3, fast_finish_pace_min=290, fast_finish_pace_max=295),
        load_level="hard",
    ))
    days.append(_day(
        w2_mon + timedelta(days=6), 2, "easy", "Rest or Easy",
        "Rest or easy 4 km",
        4.0,
        build_easy_run_steps(4.0, e_min, e_max),
        gym_workout="lower", gym_notes="Full session",
    ))

    # ===== WEEK 3: Peak Week =====
    w3_mon = start + timedelta(weeks=2)
    days.append(_day(
        w3_mon, 3, "easy", "Easy Run + Strides",
        "Easy 7 km with 6x100m strides at R-pace",
        7.0,
        build_easy_with_strides_steps(7.0, e_min, e_max, 6, r_min, r_max),
        gym_workout="push", gym_notes="Full session",
    ))
    days.append(_day(
        w3_mon + timedelta(days=1), 3, "tempo", "Race-Pace Tempo",
        "WU 2km, 7km continuous @ B-goal (284 sec/km), CD 2km",
        11.0,
        build_hm_tempo_steps(7.0, b_goal, 2.0, 2.0, e_min, e_max),
        gym_workout="pull", gym_notes="Full session",
        load_level="hard",
    ))
    days.append(_day(
        w3_mon + timedelta(days=2), 3, "rest", "REST",
        "Complete rest day",
        0.0, build_rest_day(),
    ))
    days.append(_day(
        w3_mon + timedelta(days=3), 3, "intervals", "Cruise Intervals",
        "WU 2km, 5x1000m @ T-pace (269) w/60s jog, CD 2km",
        9.0,
        build_cruise_intervals_steps(5, 1000, t_pace, 60, 2.0, 2.0, e_min, e_max),
        gym_workout="legs", gym_notes="Lighter session",
        load_level="hard",
    ))
    days.append(_day(
        w3_mon + timedelta(days=4), 3, "easy", "Easy Run + Strides",
        "Easy 6 km with 6x100m strides at R-pace",
        6.0,
        build_easy_with_strides_steps(6.0, e_min, e_max, 6, r_min, r_max),
        gym_workout="upper", gym_notes="Full session",
    ))
    days.append(_day(
        w3_mon + timedelta(days=5), 3, "long", "Long Run (Progression)",
        "20 km: 15 km @ E-pace, final 5 km progressing 293->269 sec/km. Full nutrition rehearsal.",
        20.0,
        build_progression_long_run_steps([
            (15, e_min, e_max, "Easy 15 km"),
            (2, c_goal, c_goal, "Progress to C-goal pace"),
            (2, b_goal, b_goal, "Progress to B-goal pace"),
            (1, t_pace, t_pace, "Finish at T-pace"),
        ]),
        load_level="hard",
    ))
    days.append(_day(
        w3_mon + timedelta(days=6), 3, "easy", "Rest or Easy",
        "Rest or easy 4 km",
        4.0,
        build_easy_run_steps(4.0, e_min, e_max),
        gym_workout="lower", gym_notes="Full session",
    ))

    # ===== WEEK 4: Taper =====
    w4_mon = start + timedelta(weeks=3)
    days.append(_day(
        w4_mon, 4, "easy", "Easy Run + Strides",
        "Easy 6 km with 4x100m strides. Taper week begins.",
        6.0,
        build_easy_with_strides_steps(6.0, e_min, e_max, 4, r_min, r_max),
        gym_workout="push", gym_notes="Regular session",
    ))
    days.append(_day(
        w4_mon + timedelta(days=1), 4, "tempo", "Sharpener",
        "WU 2km, 3x1600m @ B-goal (284) w/2min jog, CD 2km",
        8.8,
        build_sharpener_steps(3, 1600, b_goal, 120, 2.0, 2.0, e_min, e_max, "Sharpener"),
        gym_workout="pull", gym_notes="Regular session",
        load_level="moderate",
    ))
    days.append(_day(
        w4_mon + timedelta(days=2), 4, "easy", "Easy + Strides",
        "Easy 6 km with 4x100m strides",
        6.0,
        build_easy_with_strides_steps(6.0, e_min, e_max, 4, r_min, r_max),
    ))
    days.append(_day(
        w4_mon + timedelta(days=3), 4, "easy", "Easy Run",
        "Easy 6 km",
        6.0,
        build_easy_run_steps(6.0, e_min, e_max),
        gym_workout="legs", gym_notes="Lighter session",
    ))
    days.append(_day(
        w4_mon + timedelta(days=4), 4, "easy", "Easy + Strides",
        "Easy 5 km with 4x100m strides",
        5.0,
        build_easy_with_strides_steps(5.0, e_min, e_max, 4, r_min, r_max),
    ))
    days.append(_day(
        w4_mon + timedelta(days=5), 4, "long", "Easy Long Run",
        "Easy Long 13 km @ E-pace",
        13.0,
        build_long_run_steps(13.0, e_min, e_max),
        load_level="moderate",
    ))
    days.append(_day(
        w4_mon + timedelta(days=6), 4, "rest", "REST",
        "Rest day",
        0.0, build_rest_day(),
        # NO gym — research says skip Upper+Lower weekend in taper
    ))

    # ===== WEEK 5: Race Week =====
    w5_mon = start + timedelta(weeks=4)
    days.append(_day(
        w5_mon, 5, "easy", "Easy Run + Strides",
        "Easy 5 km with 4x100m strides",
        5.0,
        build_easy_with_strides_steps(5.0, e_min, e_max, 4, r_min, r_max),
        gym_workout="push", gym_notes="Final push session",
    ))
    days.append(_day(
        w5_mon + timedelta(days=1), 5, "tempo", "Final Sharpener",
        "WU 2km, 2x800m @ B-goal (284), 4x100m strides, CD 2km",
        6.0,
        build_final_sharpener_steps(2.0, 2, b_goal, 4, r_min, r_max, 2.0, e_min, e_max),
        gym_workout="pull", gym_notes="Final pull session. STOP gym after this.",
        load_level="moderate",
    ))
    days.append(_day(
        w5_mon + timedelta(days=2), 5, "easy", "Easy Run",
        "Easy 5 km",
        5.0,
        build_easy_run_steps(5.0, e_min, e_max),
    ))
    days.append(_day(
        w5_mon + timedelta(days=3), 5, "easy", "Easy + Strides",
        "Easy 4 km with 3x100m strides",
        4.0,
        build_easy_with_strides_steps(4.0, e_min, e_max, 3, r_min, r_max),
    ))
    days.append(_day(
        w5_mon + timedelta(days=4), 5, "rest", "REST",
        "Race week rest",
        0.0, build_rest_day(),
    ))
    days.append(_day(
        w5_mon + timedelta(days=5), 5, "easy", "Shakeout",
        "Shakeout 3 km with 3x15s pickups",
        3.0,
        build_shakeout_steps(3.0, e_min, e_max, 3),
    ))
    days.append(_day(
        w5_mon + timedelta(days=6), 5, "race", "RACE DAY",
        f"Half Marathon {race_distance_km} km — A-goal {goal_time_seconds // 60}:{goal_time_seconds % 60:02d}",
        race_distance_km,
        build_race_steps(race_distance_km, a_goal),
        load_level="race",
    ))

    return {
        "plan_name": "Knoxville HM 2026",
        "race_date": race_date,
        "race_distance_km": race_distance_km,
        "goal_time_seconds": goal_time_seconds,
        "days": days,
    }


# ===============================
# DATABASE STORAGE
# ===============================

def store_plan(conn, plan: dict) -> int:
    """Store a training plan and its days in the database.

    Args:
        conn: psycopg2 connection (caller manages commit/rollback).
        plan: Plan dict from generate_plan().

    Returns:
        The plan_id of the inserted training_plan row.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO training_plan (plan_name, race_date, race_distance_km, goal_time_seconds)
            VALUES (%s, %s, %s, %s)
            RETURNING id
            """,
            (plan["plan_name"], plan["race_date"], plan["race_distance_km"], plan["goal_time_seconds"]),
        )
        plan_id = cur.fetchone()[0]

        for day in plan["days"]:
            cur.execute(
                """
                INSERT INTO training_plan_day
                    (plan_id, day_date, week_number, day_of_week, run_type, run_title,
                     run_description, target_distance_km, target_duration_min,
                     workout_steps, gym_workout, gym_notes, load_level)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    plan_id,
                    day["day_date"],
                    day["week_number"],
                    day["day_of_week"],
                    day["run_type"],
                    day["run_title"],
                    day["run_description"],
                    day["target_distance_km"],
                    day["target_duration_min"],
                    json.dumps(day["workout_steps"]) if day["workout_steps"] else None,
                    day["gym_workout"],
                    day["gym_notes"],
                    day["load_level"],
                ),
            )

    return plan_id
