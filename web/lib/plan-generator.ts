/** Store a training plan and its days in soma's tables. The generator and its step builders live in banister. */
import type { QueryFn } from "./db";
import type { TrainingPlan } from "banister";
import { buildEasyRunSteps, buildEasyWithStridesSteps, buildCruiseIntervalsSteps, buildVo2maxIntervalsSteps, buildHmTempoSteps, buildHmPaceIntervalsSteps, buildLongRunSteps, buildProgressionLongRunSteps, buildThresholdPlusSpeedSteps, buildSharpenerSteps, buildFinalSharpenerSteps, buildRaceSteps, buildShakeoutSteps, generatePlan } from "banister";
export { buildEasyRunSteps, buildEasyWithStridesSteps, buildCruiseIntervalsSteps, buildVo2maxIntervalsSteps, buildHmTempoSteps, buildHmPaceIntervalsSteps, buildLongRunSteps, buildProgressionLongRunSteps, buildThresholdPlusSpeedSteps, buildSharpenerSteps, buildFinalSharpenerSteps, buildRaceSteps, buildShakeoutSteps, generatePlan } from "banister";
export type { WorkoutStep, PlanDay, TrainingPlan } from "banister";

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
