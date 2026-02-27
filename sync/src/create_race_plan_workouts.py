#!/usr/bin/env python3
"""
Create 7 structured Garmin workouts for the 9-day 5K race plan (Mar 7, goal 4:00/km).

Usage:
  python3 create_race_plan_workouts.py               # delete old + upload all
  python3 create_race_plan_workouts.py --dry-run     # print structure, no API calls
  python3 create_race_plan_workouts.py --only "Feb 26"
"""
import sys, argparse

sys.path.insert(0, "/Users/gkos/projects/soma/sync/src")
from garmin_client import init_garmin

# ── Pace constants (m/s) ──────────────────────────────────────────────────────
# 4:00/km target, ±5s range
RACE_FAST = 4.255   # 3:55/km  (targetValueOne — fast bound)
RACE_SLOW = 4.082   # 4:05/km  (targetValueTwo — slow bound)

# ── HR constants (bpm) ────────────────────────────────────────────────────────
# Your easy runs avg 140–154 bpm. Ceiling alerts if you accidentally push hard.
HR_EASY_MAX = 145   # ceiling for taper easy runs (warmup phases, Mar 1 body)
HR_SHAKEOUT_MAX = 140  # tighter ceiling for race-eve — truly effortless only

def hr_target(max_bpm, min_bpm=100):
    """HR bpm range target. targetValueOne=upper bpm, targetValueTwo=lower bpm.
    ID=4 (heart.rate.zone) is the correct Garmin type for custom bpm ranges.
    ID=2 maps to power.zone — do NOT use that."""
    return {
        "workoutTargetTypeId": 4,
        "workoutTargetTypeKey": "heart.rate.zone",
        "displayOrder": 4,
    }, max_bpm, min_bpm


# ── Step builders ─────────────────────────────────────────────────────────────
def _exe_step(order, type_id, type_key, cond_id, cond_key, cond_val,
              tgt_id, tgt_key, v1=None, v2=None, desc=None, child=None):
    return {
        "type": "ExecutableStepDTO",
        "stepOrder": order,
        "stepType": {"stepTypeId": type_id, "stepTypeKey": type_key, "displayOrder": type_id},
        "childStepId": child,
        "description": desc,
        "endCondition": {
            "conditionTypeId": cond_id,
            "conditionTypeKey": cond_key,
            "displayOrder": cond_id,
            "displayable": True,
        },
        "endConditionValue": float(cond_val) if cond_val is not None else None,
        "preferredEndConditionUnit": (
            {"unitId": 1, "unitKey": "meter", "factor": 100.0}
            if cond_key == "distance" else None
        ),
        "endConditionCompare": None,
        "targetType": {
            "workoutTargetTypeId": tgt_id,
            "workoutTargetTypeKey": tgt_key,
            "displayOrder": tgt_id,
        },
        "targetValueOne": v1,
        "targetValueTwo": v2,
        "targetValueUnit": None,
        "zoneNumber": None,
        "secondaryTargetType": None,
        "secondaryTargetValueOne": None,
        "secondaryTargetValueTwo": None,
        "secondaryTargetValueUnit": None,
        "secondaryZoneNumber": None,
        "endConditionZone": None,
        "strokeType":    {"strokeTypeId": 0, "strokeTypeKey": None, "displayOrder": 0},
        "equipmentType": {"equipmentTypeId": 0, "equipmentTypeKey": None, "displayOrder": 0},
        "category":      "RUN" if type_key in ("interval", "warmup", "cooldown") else None,
        "exerciseName":  "RUN" if type_key in ("interval", "warmup", "cooldown") else None,
        "workoutProvider": None,
        "providerExerciseSourceId": None,
        "weightValue": None,
        "weightUnit": None,
    }


def warmup(order, secs, desc=None, hr_max=None):
    if hr_max:
        tgt, v1, v2 = hr_target(hr_max)
        return _exe_step(order, 1, "warmup", 2, "time", secs,
                         tgt["workoutTargetTypeId"], tgt["workoutTargetTypeKey"],
                         v1, v2, desc=desc)
    return _exe_step(order, 1, "warmup", 2, "time", secs, 1, "no.target", desc=desc)

def cooldown(order, secs, desc=None):
    return _exe_step(order, 2, "cooldown", 2, "time", secs, 1, "no.target", desc=desc)

def interval_time(order, secs, tgt_id, tgt_key, v1=None, v2=None, desc=None, child=None):
    return _exe_step(order, 3, "interval", 2, "time", secs, tgt_id, tgt_key, v1, v2, desc=desc, child=child)

def interval_dist(order, meters, tgt_id, tgt_key, v1=None, v2=None, desc=None, child=None):
    return _exe_step(order, 3, "interval", 3, "distance", meters, tgt_id, tgt_key, v1, v2, desc=desc, child=child)

def recovery_time(order, secs, desc=None, child=None):
    return _exe_step(order, 4, "recovery", 2, "time", secs, 1, "no.target", desc=desc, child=child)

def recovery_dist(order, meters, desc=None, child=None):
    return _exe_step(order, 4, "recovery", 3, "distance", meters, 1, "no.target", desc=desc, child=child)

def other_lap(order, desc=None):
    return _exe_step(order, 7, "other", 1, "lap.button", None, 1, "no.target", desc=desc)

def repeat_group(order, n, child_id, sub_steps, skip_last_rest=True):
    """skip_last_rest=True omits the final recovery so the cooldown follows cleanly."""
    return {
        "type": "RepeatGroupDTO",
        "stepOrder": order,
        "stepType": {"stepTypeId": 6, "stepTypeKey": "repeat", "displayOrder": 6},
        "childStepId": child_id,
        "numberOfIterations": n,
        "workoutSteps": sub_steps,
        "endConditionValue": float(n),
        "preferredEndConditionUnit": None,
        "endConditionCompare": None,
        "endCondition": {
            "conditionTypeId": 7,
            "conditionTypeKey": "iterations",
            "displayOrder": 7,
            "displayable": False,
        },
        "skipLastRestStep": skip_last_rest,
        "smartRepeat": False,
    }


def stride_block(start_order, child_id, n=4):
    """n × (20s stride + 40s walk). Last walk is skipped automatically."""
    return repeat_group(
        start_order, n, child_id,
        [
            interval_time(
                start_order + 1, 20, 1, "no.target", child=child_id,
                desc="Stride — quick turnover, stay tall and relaxed. Not a sprint.",
            ),
            recovery_time(
                start_order + 2, 40, child=child_id,
                desc="Walk — full recovery before next stride.",
            ),
        ],
        skip_last_rest=True,
    )


def race_stride_block(start_order, child_id, n=2):
    """n × (20s stride at race pace + 40s walk). Last walk is skipped."""
    return repeat_group(
        start_order, n, child_id,
        [
            interval_time(
                start_order + 1, 20, 6, "pace.zone", RACE_FAST, RACE_SLOW, child=child_id,
                desc="Race-pace stride — 4:00/km. Feel smooth, not forced.",
            ),
            recovery_time(
                start_order + 2, 40, child=child_id,
                desc="Walk — catch your breath, stay relaxed.",
            ),
        ],
        skip_last_rest=True,
    )


def build_workout(name, steps, est_secs=None):
    return {
        "workoutName": name,
        "description": None,
        "sportType": {"sportTypeId": 1, "sportTypeKey": "running", "displayOrder": 1},
        "subSportType": None,
        "estimatedDurationInSecs": est_secs,
        "estimatedDistanceInMeters": None,
        "workoutSegments": [
            {
                "segmentOrder": 1,
                "sportType": {"sportTypeId": 1, "sportTypeKey": "running", "displayOrder": 1},
                "poolLengthUnit": None,
                "poolLength": None,
                "avgTrainingSpeed": None,
                "estimatedDurationInSecs": est_secs,
                "estimatedDistanceInMeters": None,
                "estimatedDistanceUnit": None,
                "estimateType": None,
                "description": None,
                "workoutSteps": steps,
            }
        ],
    }


# ── Workout definitions ────────────────────────────────────────────────────────

def workout_feb26():
    """Feb 26 — KEY SESSION: 5×1000m @ 4:00/km"""
    steps = [
        warmup(1, 600, hr_max=HR_EASY_MAX,
               desc="10 min easy jog. Truly easy — watch alerts if HR exceeds 150."),
        other_lap(2,
                  desc="Strides coming up. Press lap when ready."),
        stride_block(3, child_id=1, n=4),
        other_lap(6,
                  desc="Main set: 5×1000m at 4:00/km (3:55-4:05 zone). "
                       "Start the first rep conservatively — the pace should feel controlled, not maximal."),
        repeat_group(
            7, 5, child_id=2,
            sub_steps=[
                interval_dist(8, 1000, 6, "pace.zone", RACE_FAST, RACE_SLOW, child=2,
                              desc="1000m at 4:00/km race pace. Smooth, upright, quick feet. "
                                   "Watch will alert if you go outside 3:55-4:05/km."),
                recovery_dist(9, 400, child=2,
                              desc="400m easy jog recovery. Slow enough to breathe comfortably. "
                                   "Do not skip this — full recovery makes the next rep quality."),
            ],
            skip_last_rest=True,
        ),
        cooldown(10, 300,
                 desc="5 min easy cooldown jog, then walk. Great work."),
    ]
    return build_workout("Feb 26 — 5×1000m @ 4:00/km [KEY]", steps, est_secs=3900)


def workout_feb28():
    """Feb 28 — Easy 35min + 4 strides"""
    steps = [
        warmup(1, 1500, hr_max=HR_EASY_MAX,
               desc="25 min easy jog. Conversational pace — talk-test easy. "
                    "Watch alerts above 150 bpm. This is recovery from Tuesday, not a workout."),
        other_lap(2,
                  desc="4 strides coming up. Press lap when ready."),
        stride_block(3, child_id=1, n=4),
        cooldown(6, 300,
                 desc="5 min easy jog cooldown. Legs should feel springy from the strides."),
    ]
    return build_workout("Feb 28 — Easy 35min + strides", steps, est_secs=2700)


def workout_mar01():
    """Mar 1 — Easy 40min (pure aerobic, no intensity)"""
    tgt, v1, v2 = hr_target(HR_EASY_MAX)
    steps = [
        warmup(1, 600, hr_max=HR_EASY_MAX,
               desc="10 min easy start. Let the body warm up naturally."),
        interval_time(2, 1800, tgt["workoutTargetTypeId"], tgt["workoutTargetTypeKey"],
                      v1, v2,
                      desc="30 min easy aerobic pace. No watch-chasing. "
                           "Watch alerts above 150 bpm — slow down if it buzzes."),
        cooldown(3, 600,
                 desc="10 min easy finish. Wind down gradually."),
    ]
    return build_workout("Mar 1 — Easy 40min", steps, est_secs=3000)


def workout_mar02():
    """Mar 2 — Sharpening: 4×400m @ 4:00/km"""
    steps = [
        warmup(1, 900, hr_max=HR_EASY_MAX,
               desc="15 min easy warmup jog. Legs may feel heavy — normal 5 days out. "
                    "Watch alerts above 150 bpm. Keep it truly easy."),
        other_lap(2,
                  desc="4 strides to prime the legs. Press lap when ready."),
        stride_block(3, child_id=1, n=4),
        other_lap(6,
                  desc="Main set: 4×400m at race pace. These are short — go snappy and controlled. "
                       "Full recovery between each so every rep is quality."),
        repeat_group(
            7, 4, child_id=2,
            sub_steps=[
                interval_dist(8, 400, 6, "pace.zone", RACE_FAST, RACE_SLOW, child=2,
                              desc="400m at 4:00/km. Quick, light, controlled. "
                                   "Should feel like race effort but not maximal."),
                recovery_time(9, 90, child=2,
                              desc="90 sec walk/very easy jog. Full recovery — do not rush this."),
            ],
            skip_last_rest=True,
        ),
        cooldown(10, 600,
                 desc="10 min easy cooldown. Walk the last 2 min. Legs should feel good."),
    ]
    return build_workout("Mar 2 — 4×400m sharpening", steps, est_secs=2700)


def workout_mar03():
    """Mar 3 — Easy 25min + 4 strides (keep legs fresh)"""
    steps = [
        warmup(1, 900, hr_max=HR_EASY_MAX,
               desc="20 min easy jog. Purpose is blood flow, not fitness. "
                    "Watch alerts above 150 bpm — if it buzzes, walk for 30 sec."),
        other_lap(2,
                  desc="4 short strides to keep the legs sharp. Press lap when ready."),
        stride_block(3, child_id=1, n=4),
        cooldown(6, 300,
                 desc="5 min easy jog cooldown. Done for the day — rest tomorrow."),
    ]
    return build_workout("Mar 3 — Easy 25min + strides", steps, est_secs=1800)


def workout_mar04():
    """Mar 4 — Easy 20min + 4 strides (light legs day)"""
    steps = [
        warmup(1, 720, hr_max=HR_EASY_MAX,
               desc="12 min easy jog. Legs may feel flat — that is taper, trust it. "
                    "Watch alerts above 150 bpm. This is your last real workout."),
        other_lap(2,
                  desc="4 strides to stay sharp. Press lap when ready."),
        stride_block(3, child_id=1, n=4),
        cooldown(6, 300,
                 desc="5 min easy jog or walk. Last real workout before race. "
                      "Tomorrow is rest, day after is shakeout."),
    ]
    return build_workout("Mar 4 — Easy 20min + strides", steps, est_secs=1500)


def workout_mar06():
    """Mar 6 — Race-eve shakeout: 15min + 6 strides (last 2 at race pace)"""
    steps = [
        warmup(1, 900, hr_max=HR_SHAKEOUT_MAX,
               desc="15 min very easy shakeout jog. Legs are primed — do not push. "
                    "Watch alerts above 145 bpm. If it buzzes, you are going too hard."),
        other_lap(2,
                  desc="4 easy strides by feel — no watch target. Press lap when ready."),
        stride_block(3, child_id=1, n=4),
        other_lap(6,
                  desc="2 final strides at race pace (4:00/km). "
                       "Remind the legs what tomorrow feels like. Smooth and confident."),
        race_stride_block(7, child_id=2, n=2),
        cooldown(10, 120,
                 desc="2 min walk out. You are ready. Rest well tonight, eat your carbs, "
                      "sleep early. Race is tomorrow."),
    ]
    return build_workout("Mar 6 — Race-eve shakeout", steps, est_secs=1500)


# ── Workout registry (date, function, old_workout_id_to_delete) ───────────────
# Note: Garmin API does not support DELETE for workouts. Old IDs kept for reference
# but auto-delete will be skipped (405). Delete manually from Garmin Connect if needed.
WORKOUTS = [
    ("Feb 26", workout_feb26, 1486962686),
    ("Feb 28", workout_feb28, 1486962694),
    ("Mar 1",  workout_mar01, 1486962697),
    ("Mar 2",  workout_mar02, 1486962701),
    ("Mar 3",  workout_mar03, 1486962704),
    ("Mar 4",  workout_mar04, 1486962708),
    ("Mar 6",  workout_mar06, 1486962711),
]


def delete_workout(g, workout_id):
    try:
        g.garth.delete("connect", f"/workout-service/workout/{workout_id}")
        return True
    except Exception as e:
        print(f"    (delete {workout_id} failed: {e})")
        return False


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true",
                        help="Print structure only, no API calls")
    parser.add_argument("--only", metavar="DATE",
                        help="Process only this date (e.g. 'Feb 26')")
    parser.add_argument("--no-delete", action="store_true",
                        help="Skip deleting old workouts before uploading")
    args = parser.parse_args()

    if not args.dry_run:
        g = init_garmin()

    for date, fn, old_id in WORKOUTS:
        if args.only and date != args.only:
            continue
        w = fn()
        if args.dry_run:
            print(f"\n{'='*65}")
            print(f"  {w['workoutName']}")
            print(f"{'='*65}")
            steps = w["workoutSegments"][0]["workoutSteps"]

            def describe(steps, indent=0):
                for s in steps:
                    if s["type"] == "RepeatGroupDTO":
                        skip = " [skip-last-rest]" if s.get("skipLastRestStep") else ""
                        print(" " * indent + f"REPEAT ×{s['numberOfIterations']}{skip}")
                        describe(s["workoutSteps"], indent + 2)
                    else:
                        ec = s["endCondition"]
                        tt = s["targetType"]
                        cond = f"{ec['conditionTypeKey']} {s['endConditionValue']}"
                        tgt = tt["workoutTargetTypeKey"]
                        if s.get("targetValueOne") is not None:
                            v1_, v2_ = s["targetValueOne"], s["targetValueTwo"]
                            if tgt == "heart.rate":
                                tgt += f" [{int(v2_)}–{int(v1_)} bpm]"
                            elif tgt == "pace.zone":
                                p1 = 1000 / v1_; p2 = 1000 / v2_
                                m1, s1_ = int(p1) // 60, int(p1) % 60
                                m2, s2_ = int(p2) // 60, int(p2) % 60
                                tgt += f" [{m1}:{s1_:02d}–{m2}:{s2_:02d}/km]"
                            else:
                                tgt += f" [{v1_}–{v2_}]"
                        desc_short = (s.get("description") or "")[:60]
                        print(" " * indent + f"  {s['stepType']['stepTypeKey']:10} {cond:25} {tgt}")
                        if desc_short:
                            print(" " * indent + f"  {'':10} {desc_short}")

            describe(steps)
        else:
            if not args.no_delete and old_id:
                print(f"  Deleting old {date} workout ({old_id})...")
                delete_workout(g, old_id)
            result = g.upload_workout(w)
            wid = result.get("workoutId", "?")
            print(f"  {date}: {w['workoutName']} → workoutId={wid}")


if __name__ == "__main__":
    main()
