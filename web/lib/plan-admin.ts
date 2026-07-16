/**
 * Training-plan admin operations — TS port of the manual CLI tools
 * training_engine/init_plan.py and regenerate_workout_steps.py. These are the
 * last non-cron pieces of the sync cutover (#187): create a new plan (generate +
 * store + activate + optional Garmin push) and regenerate workout_steps on the
 * active plan's future days. Invoked via /api/admin/plan (CRON_SECRET-gated).
 */
import type { GarminClient } from "garmin-auth";
import type { QueryFn } from "./db";
import { allPaces, hmGoalPaces } from "./vdot";
import {
  generatePlan, storePlan,
  buildEasyRunSteps, buildEasyWithStridesSteps, buildLongRunSteps,
  buildCruiseIntervalsSteps, buildVo2maxIntervalsSteps, buildHmPaceIntervalsSteps,
  buildHmTempoSteps, buildThresholdPlusSpeedSteps, buildProgressionLongRunSteps,
  buildSharpenerSteps, buildFinalSharpenerSteps, buildShakeoutSteps, buildRaceSteps,
  type WorkoutStep,
} from "./plan-generator";
import { pushPlanToGarmin, type PushResult } from "./garmin-workout-builder";

const PLAN_VDOT = 47;

export interface CreatePlanResult { planId: number; days: number; pushed?: PushResult }

/**
 * Generate a 5-week HM plan, store it, make it the single active plan, and
 * (optionally) push its workouts to Garmin now. Port of initialize_training_plan
 * (which additionally sets status='active' + deactivates prior plans so the
 * plan-push cron continues pushing the remaining days). DB [+ Garmin if push].
 */
export async function createPlan(
  sql: QueryFn, client: GarminClient | null,
  opts: { raceDate: string; raceDistanceKm?: number; goalTimeSeconds?: number; vdot?: number; push?: boolean },
): Promise<CreatePlanResult> {
  const plan = generatePlan(opts.raceDate, opts.raceDistanceKm ?? 21.1, opts.goalTimeSeconds ?? 5700, opts.vdot ?? PLAN_VDOT);
  const planId = await storePlan(sql, plan);
  // Single active plan: deactivate any others, activate this one.
  await sql`UPDATE training_plan SET status = 'inactive' WHERE status = 'active' AND id != ${planId}`;
  await sql`UPDATE training_plan SET status = 'active' WHERE id = ${planId}`;

  let pushed: PushResult | undefined;
  if (opts.push && client) pushed = await pushPlanToGarmin(sql, client, planId);
  return { planId, days: plan.days.length, pushed };
}

/** Rebuild workout_steps for a future non-rest plan day by matching its title. Port of regenerate.build_steps. */
function buildSteps(runTitle: string, targetDistanceKm: number, weekNumber: number): WorkoutStep[] | null {
  const paces = allPaces(PLAN_VDOT);
  const goals = hmGoalPaces(PLAN_VDOT);
  const [eMin, eMax] = paces.E;
  const tPace = paces.T[0], iPace = paces.I[0];
  const [rMin, rMax] = paces.R;
  const bGoal = goals.B, aGoal = goals.A, cGoal = goals.C;
  const title = runTitle.trim();

  if (title === "REST") return null;
  if (title === "RACE DAY") return buildRaceSteps(21.1, aGoal);
  if (title.includes("Shakeout")) return buildShakeoutSteps(targetDistanceKm, 3);
  if (title === "Final Sharpener") return buildFinalSharpenerSteps(2.0, 2, bGoal, 4, rMin, rMax, 2.0);
  if (title === "Sharpener") return buildSharpenerSteps(3, 1600, bGoal, 120, 2.0, 2.0, "Sharpener");
  if (title === "Cruise Intervals") {
    if (weekNumber === 3) return buildCruiseIntervalsSteps(5, 1000, tPace, 60, 2.0, 2.0);
    return buildCruiseIntervalsSteps(4, 1600, tPace, 90, 2.0, 2.0);
  }
  if (title === "VO2max Intervals") return buildVo2maxIntervalsSteps(5, 1000, iPace, 180, 2.0, 2.0);
  if (title === "HM-Pace Tempo") return buildHmPaceIntervalsSteps(3, 2000, bGoal, 120, 2.0, 2.0);
  if (title === "Race-Pace Tempo") return buildHmTempoSteps(7.0, bGoal, 2.0, 2.0);
  if (title === "Threshold + Speed") return buildThresholdPlusSpeedSteps(3, 1600, tPace, 90, 4, 200, rMin, rMax, 200, 2.0, 1.0);
  if (title.includes("Long Run (Progression)")) {
    return buildProgressionLongRunSteps([[15, eMin, eMax, "Easy 15 km"], [2, cGoal, cGoal, "Progress to C-goal pace"], [2, bGoal, bGoal, "Progress to B-goal pace"], [1, tPace, tPace, "Finish at T-pace"]]);
  }
  if (title.includes("Long Run (Fast Finish)")) return buildLongRunSteps(targetDistanceKm, eMin, eMax, 3, 290, 295);
  if (title.includes("Long Run") || title.includes("Easy Long")) return buildLongRunSteps(targetDistanceKm, eMin, eMax);
  if (title.includes("Strides")) {
    let strideCount = 6;
    if (weekNumber >= 4) strideCount = 4;
    if (weekNumber === 5 && targetDistanceKm <= 4) strideCount = 3;
    return buildEasyWithStridesSteps(targetDistanceKm, eMin, eMax, strideCount, rMin, rMax);
  }
  if (title.includes("Easy Run") || title.includes("Rest or Easy")) return buildEasyRunSteps(targetDistanceKm);
  return null; // unrecognized title — skip
}

export interface RegenResult { updated: number; skipped: number }

/**
 * Regenerate workout_steps for all future non-rest plan days, flipping
 * garmin_push_status pushed→pending so the plan-push cron re-pushes them.
 * Port of regenerate(). DB.
 */
export async function regenerateWorkoutSteps(sql: QueryFn): Promise<RegenResult> {
  const rows = await sql`
    SELECT id, run_title, target_distance_km, week_number
    FROM training_plan_day
    WHERE day_date >= CURRENT_DATE AND run_type != 'rest'
    ORDER BY day_date`;
  let updated = 0, skipped = 0;
  for (const row of rows) {
    const steps = buildSteps(row.run_title, Number(row.target_distance_km), Number(row.week_number));
    if (steps === null) { skipped += 1; continue; }
    await sql`
      UPDATE training_plan_day
      SET workout_steps = ${JSON.stringify(steps)}::jsonb,
          garmin_push_status = CASE WHEN garmin_push_status = 'pushed' THEN 'pending' ELSE garmin_push_status END
      WHERE id = ${row.id}`;
    updated += 1;
  }
  return { updated, skipped };
}
