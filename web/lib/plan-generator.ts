/**
 * 5-week half-marathon plan generator — TS port of
 * sync/src/training_engine/plan_generator.py. A hardcoded Daniels-based
 * 5-week/35-day template instantiated with dates and paces from the athlete's
 * VDOT (via the ported vdot module). Pure generation + a DB store step
 * (training_plan / training_plan_day). Stage: training engine (#187).
 */
import type { QueryFn } from "./db";
import { allPaces, hmGoalPaces } from "./vdot";

// ---- date helpers (YYYY-MM-DD, UTC; weekday Monday=0 like Python date.weekday) ----
const MS_DAY = 86_400_000;
function addDays(d: string, n: number): string {
  return new Date(Date.parse(d + "T00:00:00Z") + n * MS_DAY).toISOString().slice(0, 10);
}
function weekday(d: string): number {
  return (new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7; // Mon=0..Sun=6
}

// ---- workout step builders ----
export interface WorkoutStep {
  step_type: string;
  duration_type: string;
  duration_value: number;
  target_type: string;
  description: string;
  target_pace_min?: number;
  target_pace_max?: number;
  hr_zone?: number;
}

function step(
  stepType: string, durationType: string, durationValue: number, targetType = "open",
  targetPaceMin: number | null = null, targetPaceMax: number | null = null,
  description = "", hrZone: number | null = null,
): WorkoutStep {
  const s: WorkoutStep = {
    step_type: stepType, duration_type: durationType, duration_value: durationValue,
    target_type: targetType, description,
  };
  if (targetType === "pace" && targetPaceMin !== null) {
    s.target_pace_min = targetPaceMin;
    s.target_pace_max = targetPaceMax as number;
  }
  if (hrZone !== null) s.hr_zone = hrZone;
  return s;
}

const warmup = (m: number) => step("warmup", "distance", m, "hr", null, null, "Easy warmup", 2);
const cooldown = (m: number) => step("cooldown", "distance", m, "hr", null, null, "Easy cooldown", 2);
const lapButton = (d = "Press lap to continue") => step("rest", "lap_button", 0, "open", null, null, d);
const recoveryJog = (sec: number) => step("recovery", "time", sec, "hr", null, null, "Recovery jog", 2);
const recoveryJogDistance = (m: number) => step("recovery", "distance", m, "hr", null, null, "Recovery jog", 2);

const PACE_RANGE = 7;

export function buildEasyRunSteps(distanceKm: number): WorkoutStep[] {
  return [step("warmup", "distance", Math.trunc(distanceKm * 1000), "hr", null, null, `Easy ${fmt(distanceKm)} km`, 2)];
}

export function buildEasyWithStridesSteps(distanceKm: number, _eMin: number, _eMax: number, strideCount: number, rMin: number, rMax: number): WorkoutStep[] {
  const easyDistance = Math.trunc((distanceKm - 0.5) * 1000);
  const steps: WorkoutStep[] = [
    step("warmup", "distance", easyDistance, "hr", null, null, "Easy run", 2),
    lapButton("Press lap to start strides"),
  ];
  const repeatCount = strideCount - 1;
  for (let i = 0; i < repeatCount; i++) {
    steps.push(step("interval", "time", 20, "pace", rMin, rMax, `Stride ${i + 1}/${repeatCount}`, 4));
    steps.push(recoveryJog(60));
  }
  steps.push(step("interval", "time", 20, "pace", rMin, rMax, "Final stride", 4));
  steps.push(step("cooldown", "distance", 500, "hr", null, null, "Easy cooldown", 2));
  return steps;
}

export function buildCruiseIntervalsSteps(reps: number, repDistanceM: number, tPace: number, recoverySec: number, wuKm: number, cdKm: number): WorkoutStep[] {
  const steps = [warmup(Math.trunc(wuKm * 1000)), lapButton("Press lap to start intervals")];
  for (let i = 0; i < reps; i++) {
    steps.push(step("interval", "distance", repDistanceM, "pace", tPace - PACE_RANGE, tPace + PACE_RANGE, `Cruise interval ${i + 1}/${reps} @ T-pace`, 3));
    if (i < reps - 1) steps.push(recoveryJog(recoverySec));
  }
  steps.push(cooldown(Math.trunc(cdKm * 1000)));
  return steps;
}

export function buildVo2maxIntervalsSteps(reps: number, repDistanceM: number, iPace: number, recoverySec: number, wuKm: number, cdKm: number): WorkoutStep[] {
  const steps = [warmup(Math.trunc(wuKm * 1000)), lapButton("Press lap to start intervals")];
  for (let i = 0; i < reps; i++) {
    steps.push(step("interval", "distance", repDistanceM, "pace", iPace - PACE_RANGE, iPace + PACE_RANGE, `VO2max interval ${i + 1}/${reps} @ I-pace`, 4));
    if (i < reps - 1) steps.push(recoveryJog(recoverySec));
  }
  steps.push(cooldown(Math.trunc(cdKm * 1000)));
  return steps;
}

export function buildHmTempoSteps(tempoDistanceKm: number, tempoPace: number, wuKm: number, cdKm: number): WorkoutStep[] {
  return [
    warmup(Math.trunc(wuKm * 1000)),
    lapButton("Press lap to start tempo"),
    step("interval", "distance", Math.trunc(tempoDistanceKm * 1000), "pace", tempoPace - PACE_RANGE, tempoPace + PACE_RANGE, `${fmt(tempoDistanceKm)} km continuous @ HM pace`, 3),
    cooldown(Math.trunc(cdKm * 1000)),
  ];
}

export function buildHmPaceIntervalsSteps(reps: number, repDistanceM: number, hmPace: number, recoverySec: number, wuKm: number, cdKm: number): WorkoutStep[] {
  const steps = [warmup(Math.trunc(wuKm * 1000)), lapButton("Press lap to start intervals")];
  for (let i = 0; i < reps; i++) {
    steps.push(step("interval", "distance", repDistanceM, "pace", hmPace - PACE_RANGE, hmPace + PACE_RANGE, `HM-pace rep ${i + 1}/${reps}`, 3));
    if (i < reps - 1) steps.push(recoveryJog(recoverySec));
  }
  steps.push(cooldown(Math.trunc(cdKm * 1000)));
  return steps;
}

export function buildLongRunSteps(distanceKm: number, eMin: number, eMax: number, fastFinishKm = 0, fastFinishPaceMin: number | null = null, fastFinishPaceMax: number | null = null): WorkoutStep[] {
  if (fastFinishKm > 0 && fastFinishPaceMin !== null) {
    const easyKm = distanceKm - fastFinishKm;
    return [
      step("warmup", "distance", Math.trunc(easyKm * 1000), "pace", eMin, eMax, `Easy ${fmt(easyKm)} km`, 2),
      // fast_finish_km is passed as an int in the plan (3), so Python renders "3" not "3.0".
      step("interval", "distance", Math.trunc(fastFinishKm * 1000), "pace", fastFinishPaceMin, fastFinishPaceMax, `Fast finish ${fastFinishKm} km`, 3),
    ];
  }
  return [step("warmup", "distance", Math.trunc(distanceKm * 1000), "pace", eMin, eMax, `Long run ${fmt(distanceKm)} km`, 2)];
}

export function buildProgressionLongRunSteps(segments: Array<[number, number, number, string]>): WorkoutStep[] {
  return segments.map(([km, paceMin, paceMax, desc], i) =>
    step(i === 0 ? "warmup" : "interval", "distance", Math.trunc(km * 1000), "pace", paceMin, paceMax, desc, i === 0 ? 2 : 3));
}

export function buildThresholdPlusSpeedSteps(
  tReps: number, tDistanceM: number, tPace: number, tRecoverySec: number,
  rReps: number, rDistanceM: number, rMin: number, rMax: number, rRecoveryM: number,
  wuKm: number, cdKm: number,
): WorkoutStep[] {
  const steps = [warmup(Math.trunc(wuKm * 1000)), lapButton("Press lap to start threshold")];
  for (let i = 0; i < tReps; i++) {
    steps.push(step("interval", "distance", tDistanceM, "pace", tPace - PACE_RANGE, tPace + PACE_RANGE, `Threshold ${i + 1}/${tReps} @ T-pace`, 3));
    if (i < tReps - 1) steps.push(recoveryJog(tRecoverySec));
  }
  steps.push(lapButton("Press lap to start speed reps"));
  for (let i = 0; i < rReps; i++) {
    steps.push(step("interval", "distance", rDistanceM, "pace", rMin, rMax, `Speed rep ${i + 1}/${rReps} @ R-pace`, 4));
    if (i < rReps - 1) steps.push(recoveryJogDistance(rRecoveryM));
  }
  steps.push(cooldown(Math.trunc(cdKm * 1000)));
  return steps;
}

export function buildSharpenerSteps(reps: number, repDistanceM: number, pace: number, recoverySec: number, wuKm: number, cdKm: number, description = "Sharpener"): WorkoutStep[] {
  const steps = [warmup(Math.trunc(wuKm * 1000)), lapButton("Press lap to start intervals")];
  for (let i = 0; i < reps; i++) {
    steps.push(step("interval", "distance", repDistanceM, "pace", pace - PACE_RANGE, pace + PACE_RANGE, `${description} ${i + 1}/${reps}`, 3));
    if (i < reps - 1) steps.push(recoveryJog(recoverySec));
  }
  steps.push(cooldown(Math.trunc(cdKm * 1000)));
  return steps;
}

export function buildFinalSharpenerSteps(wuKm: number, reps800: number, pace800: number, strideCount: number, rMin: number, rMax: number, cdKm: number): WorkoutStep[] {
  const steps = [warmup(Math.trunc(wuKm * 1000)), lapButton("Press lap to start intervals")];
  for (let i = 0; i < reps800; i++) {
    steps.push(step("interval", "distance", 800, "pace", pace800 - PACE_RANGE, pace800 + PACE_RANGE, `800m rep ${i + 1}/${reps800} @ HM pace`, 3));
    if (i < reps800 - 1) steps.push(recoveryJog(120));
  }
  steps.push(recoveryJog(90));
  const repeatCount = strideCount - 1;
  for (let i = 0; i < repeatCount; i++) {
    steps.push(step("interval", "time", 20, "pace", rMin, rMax, `Stride ${i + 1}/${repeatCount}`, 4));
    steps.push(recoveryJog(60));
  }
  steps.push(step("interval", "time", 20, "pace", rMin, rMax, "Final stride", 4));
  steps.push(cooldown(Math.trunc(cdKm * 1000)));
  return steps;
}

export function buildRaceSteps(distanceKm: number, goalPace: number): WorkoutStep[] {
  return [
    step("warmup", "distance", 2000, "open", null, null, "Pre-race warmup", 2),
    step("interval", "distance", Math.trunc(distanceKm * 1000), "pace", goalPace, goalPace, `RACE ${fmt(distanceKm)} km`, 3),
  ];
}

export function buildShakeoutSteps(distanceKm: number, pickupCount = 3): WorkoutStep[] {
  const steps = [step("warmup", "distance", Math.trunc(distanceKm * 1000 - 500), "hr", null, null, "Easy shakeout", 2)];
  for (let i = 0; i < pickupCount; i++) steps.push(step("interval", "time", 15, "open", null, null, `Pickup ${i + 1}/${pickupCount} (15s)`, 3));
  steps.push(step("cooldown", "distance", 500, "hr", null, null, "Easy cooldown", 2));
  return steps;
}

/** Format a km value the way Python str() does: 7.0 -> "7.0", 10.4 -> "10.4". */
function fmt(n: number): string {
  return Number.isInteger(n) ? `${n}.0` : String(n);
}

// ---- plan assembly ----
function computeStartDate(raceDate: string): string {
  return addDays(addDays(raceDate, -6), -28); // race Sunday -> Monday, then back 4 weeks
}

export interface PlanDay {
  day_date: string;
  week_number: number;
  day_of_week: number;
  run_type: string;
  run_title: string;
  run_description: string;
  target_distance_km: number;
  target_duration_min: number | null;
  workout_steps: WorkoutStep[] | null;
  gym_workout: string | null;
  gym_notes: string | null;
  load_level: string;
}

function day(
  dayDate: string, weekNumber: number, runType: string, runTitle: string, runDescription: string,
  targetDistanceKm: number, workoutSteps: WorkoutStep[] | null,
  opts: { gym_workout?: string | null; gym_notes?: string | null; load_level?: string; target_duration_min?: number | null } = {},
): PlanDay {
  return {
    day_date: dayDate, week_number: weekNumber, day_of_week: weekday(dayDate),
    run_type: runType, run_title: runTitle, run_description: runDescription,
    target_distance_km: targetDistanceKm, target_duration_min: opts.target_duration_min ?? null,
    workout_steps: workoutSteps, gym_workout: opts.gym_workout ?? null, gym_notes: opts.gym_notes ?? null,
    load_level: opts.load_level ?? "easy",
  };
}

export interface TrainingPlan {
  plan_name: string;
  race_date: string;
  race_distance_km: number;
  goal_time_seconds: number;
  days: PlanDay[];
}

/** Generate the 5-week HM plan (defaults match the Python signature). */
export function generatePlan(
  raceDate: string,
  raceDistanceKm = 21.1,
  goalTimeSeconds = 5700,
  vdot = 47,
): TrainingPlan {
  const paces = allPaces(vdot);
  const goals = hmGoalPaces(vdot);
  const [eMin, eMax] = paces.E;
  const tPace = paces.T[0];
  const iPace = paces.I[0];
  const [rMin, rMax] = paces.R;
  const bGoal = goals.B, aGoal = goals.A, cGoal = goals.C;

  const start = computeStartDate(raceDate);
  const days: PlanDay[] = [];

  // WEEK 1
  const w1 = start;
  days.push(day(w1, 1, "easy", "Easy Run + Strides", "Easy 7 km with 6x100m strides at R-pace", 7.0, buildEasyWithStridesSteps(7.0, eMin, eMax, 6, rMin, rMax), { gym_workout: "push", gym_notes: "Full session" }));
  days.push(day(addDays(w1, 1), 1, "tempo", "Cruise Intervals", "WU 2km, 4x1600m @ T-pace (269 sec/km) w/90s jog, CD 2km", 10.4, buildCruiseIntervalsSteps(4, 1600, tPace, 90, 2.0, 2.0), { gym_workout: "pull", gym_notes: "Full session", load_level: "hard" }));
  days.push(day(addDays(w1, 2), 1, "rest", "REST", "Complete rest day", 0.0, null));
  days.push(day(addDays(w1, 3), 1, "intervals", "VO2max Intervals", "WU 2km, 5x1000m @ I-pace (249 sec/km) w/3min jog, CD 2km", 9.0, buildVo2maxIntervalsSteps(5, 1000, iPace, 180, 2.0, 2.0), { gym_workout: "legs", gym_notes: "Full session", load_level: "hard" }));
  days.push(day(addDays(w1, 4), 1, "easy", "Easy Run + Strides", "Easy 6 km with 6x100m strides at R-pace", 6.0, buildEasyWithStridesSteps(6.0, eMin, eMax, 6, rMin, rMax), { gym_workout: "upper", gym_notes: "Full session" }));
  days.push(day(addDays(w1, 5), 1, "long", "Long Run", "Long Run 15 km @ E-pace", 15.0, buildLongRunSteps(15.0, eMin, eMax), { load_level: "moderate" }));
  days.push(day(addDays(w1, 6), 1, "easy", "Rest or Easy", "Rest or easy 4 km", 4.0, buildEasyRunSteps(4.0), { gym_workout: "lower", gym_notes: "Full session" }));

  // WEEK 2
  const w2 = addDays(start, 7);
  days.push(day(w2, 2, "easy", "Easy Run + Strides", "Easy 7 km with 6x100m strides at R-pace", 7.0, buildEasyWithStridesSteps(7.0, eMin, eMax, 6, rMin, rMax), { gym_workout: "push", gym_notes: "Full session" }));
  days.push(day(addDays(w2, 1), 2, "tempo", "HM-Pace Tempo", "WU 2km, 3x2km @ B-goal (284 sec/km) w/2min jog, CD 2km", 10.0, buildHmPaceIntervalsSteps(3, 2000, bGoal, 120, 2.0, 2.0), { gym_workout: "pull", gym_notes: "Full session", load_level: "hard" }));
  days.push(day(addDays(w2, 2), 2, "rest", "REST", "Complete rest day", 0.0, null));
  days.push(day(addDays(w2, 3), 2, "intervals", "Threshold + Speed", "WU 2km, 3x1600m @ T-pace w/90s jog, 4x200m @ R-pace w/200m jog, CD 1km", 9.4, buildThresholdPlusSpeedSteps(3, 1600, tPace, 90, 4, 200, rMin, rMax, 200, 2.0, 1.0), { gym_workout: "legs", gym_notes: "Full session", load_level: "hard" }));
  days.push(day(addDays(w2, 4), 2, "easy", "Easy Run + Strides", "Easy 6 km with 6x100m strides at R-pace", 6.0, buildEasyWithStridesSteps(6.0, eMin, eMax, 6, rMin, rMax), { gym_workout: "upper", gym_notes: "Full session" }));
  days.push(day(addDays(w2, 5), 2, "long", "Long Run (Fast Finish)", "18 km: 15 km @ E-pace, final 3 km @ 290-295 sec/km. Practice gel.", 18.0, buildLongRunSteps(18.0, eMin, eMax, 3, 290, 295), { load_level: "hard" }));
  days.push(day(addDays(w2, 6), 2, "easy", "Rest or Easy", "Rest or easy 4 km", 4.0, buildEasyRunSteps(4.0), { gym_workout: "lower", gym_notes: "Full session" }));

  // WEEK 3
  const w3 = addDays(start, 14);
  days.push(day(w3, 3, "easy", "Easy Run + Strides", "Easy 7 km with 6x100m strides at R-pace", 7.0, buildEasyWithStridesSteps(7.0, eMin, eMax, 6, rMin, rMax), { gym_workout: "push", gym_notes: "Full session" }));
  days.push(day(addDays(w3, 1), 3, "tempo", "Race-Pace Tempo", "WU 2km, 7km continuous @ B-goal (284 sec/km), CD 2km", 11.0, buildHmTempoSteps(7.0, bGoal, 2.0, 2.0), { gym_workout: "pull", gym_notes: "Full session", load_level: "hard" }));
  days.push(day(addDays(w3, 2), 3, "rest", "REST", "Complete rest day", 0.0, null));
  days.push(day(addDays(w3, 3), 3, "intervals", "Cruise Intervals", "WU 2km, 5x1000m @ T-pace (269) w/60s jog, CD 2km", 9.0, buildCruiseIntervalsSteps(5, 1000, tPace, 60, 2.0, 2.0), { gym_workout: "legs", gym_notes: "Lighter session", load_level: "hard" }));
  days.push(day(addDays(w3, 4), 3, "easy", "Easy Run + Strides", "Easy 6 km with 6x100m strides at R-pace", 6.0, buildEasyWithStridesSteps(6.0, eMin, eMax, 6, rMin, rMax), { gym_workout: "upper", gym_notes: "Full session" }));
  days.push(day(addDays(w3, 5), 3, "long", "Long Run (Progression)", "20 km: 15 km @ E-pace, final 5 km progressing 293->269 sec/km. Full nutrition rehearsal.", 20.0, buildProgressionLongRunSteps([[15, eMin, eMax, "Easy 15 km"], [2, cGoal, cGoal, "Progress to C-goal pace"], [2, bGoal, bGoal, "Progress to B-goal pace"], [1, tPace, tPace, "Finish at T-pace"]]), { load_level: "hard" }));
  days.push(day(addDays(w3, 6), 3, "easy", "Rest or Easy", "Rest or easy 4 km", 4.0, buildEasyRunSteps(4.0), { gym_workout: "lower", gym_notes: "Full session" }));

  // WEEK 4 (taper)
  const w4 = addDays(start, 21);
  days.push(day(w4, 4, "easy", "Easy Run + Strides", "Easy 6 km with 4x100m strides. Taper week begins.", 6.0, buildEasyWithStridesSteps(6.0, eMin, eMax, 4, rMin, rMax), { gym_workout: "push", gym_notes: "Regular session" }));
  days.push(day(addDays(w4, 1), 4, "tempo", "Sharpener", "WU 2km, 3x1600m @ B-goal (284) w/2min jog, CD 2km", 8.8, buildSharpenerSteps(3, 1600, bGoal, 120, 2.0, 2.0, "Sharpener"), { gym_workout: "pull", gym_notes: "Regular session", load_level: "moderate" }));
  days.push(day(addDays(w4, 2), 4, "easy", "Easy + Strides", "Easy 6 km with 4x100m strides", 6.0, buildEasyWithStridesSteps(6.0, eMin, eMax, 4, rMin, rMax)));
  days.push(day(addDays(w4, 3), 4, "easy", "Easy Run", "Easy 6 km", 6.0, buildEasyRunSteps(6.0), { gym_workout: "legs", gym_notes: "Lighter session" }));
  days.push(day(addDays(w4, 4), 4, "easy", "Easy + Strides", "Easy 5 km with 4x100m strides", 5.0, buildEasyWithStridesSteps(5.0, eMin, eMax, 4, rMin, rMax)));
  days.push(day(addDays(w4, 5), 4, "long", "Easy Long Run", "Easy Long 13 km @ E-pace", 13.0, buildLongRunSteps(13.0, eMin, eMax), { load_level: "moderate" }));
  days.push(day(addDays(w4, 6), 4, "rest", "REST", "Rest day", 0.0, null));

  // WEEK 5 (race week)
  const w5 = addDays(start, 28);
  days.push(day(w5, 5, "easy", "Easy Run + Strides", "Easy 5 km with 4x100m strides", 5.0, buildEasyWithStridesSteps(5.0, eMin, eMax, 4, rMin, rMax), { gym_workout: "push", gym_notes: "Final push session" }));
  days.push(day(addDays(w5, 1), 5, "tempo", "Final Sharpener", "WU 2km, 2x800m @ B-goal (284), 4x100m strides, CD 2km", 6.0, buildFinalSharpenerSteps(2.0, 2, bGoal, 4, rMin, rMax, 2.0), { gym_workout: "pull", gym_notes: "Final pull session. STOP gym after this.", load_level: "moderate" }));
  days.push(day(addDays(w5, 2), 5, "easy", "Easy Run", "Easy 5 km", 5.0, buildEasyRunSteps(5.0)));
  days.push(day(addDays(w5, 3), 5, "easy", "Easy + Strides", "Easy 4 km with 3x100m strides", 4.0, buildEasyWithStridesSteps(4.0, eMin, eMax, 3, rMin, rMax)));
  days.push(day(addDays(w5, 4), 5, "rest", "REST", "Race week rest", 0.0, null));
  days.push(day(addDays(w5, 5), 5, "easy", "Shakeout", "Shakeout 3 km with 3x15s pickups", 3.0, buildShakeoutSteps(3.0, 3)));
  const goalMin = Math.floor(goalTimeSeconds / 60), goalSec = goalTimeSeconds % 60;
  days.push(day(addDays(w5, 6), 5, "race", "RACE DAY", `Half Marathon ${fmt(raceDistanceKm)} km — A-goal ${goalMin}:${String(goalSec).padStart(2, "0")}`, raceDistanceKm, buildRaceSteps(raceDistanceKm, aGoal), { load_level: "race" }));

  return { plan_name: "Knoxville HM 2026", race_date: raceDate, race_distance_km: raceDistanceKm, goal_time_seconds: goalTimeSeconds, days };
}

/**
 * Store a plan and its days. Port of store_plan. Returns the new plan_id. DB.
 */
export async function storePlan(sql: QueryFn, plan: TrainingPlan): Promise<number> {
  const planRows = await sql`
    INSERT INTO training_plan (plan_name, race_date, race_distance_km, goal_time_seconds)
    VALUES (${plan.plan_name}, ${plan.race_date}, ${plan.race_distance_km}, ${plan.goal_time_seconds})
    RETURNING id`;
  const planId = Number(planRows[0].id);
  for (const d of plan.days) {
    await sql`
      INSERT INTO training_plan_day
        (plan_id, day_date, week_number, day_of_week, run_type, run_title, run_description,
         target_distance_km, target_duration_min, workout_steps, gym_workout, gym_notes, load_level)
      VALUES (${planId}, ${d.day_date}, ${d.week_number}, ${d.day_of_week}, ${d.run_type}, ${d.run_title},
              ${d.run_description}, ${d.target_distance_km}, ${d.target_duration_min},
              ${d.workout_steps ? JSON.stringify(d.workout_steps) : null}::jsonb,
              ${d.gym_workout}, ${d.gym_notes}, ${d.load_level})`;
  }
  return planId;
}
