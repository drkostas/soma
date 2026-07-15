/**
 * Convert training-plan workout steps to Garmin structured workouts + push them
 * — TS port of sync/src/training_engine/garmin_workout_builder.py.
 *
 * `stepsToGarminWorkout` (pure) translates our workout_steps JSONB into Garmin's
 * workout API payload. `pushPlanToGarmin` (DB + EXTERNAL Garmin writes) uploads
 * pending plan days and schedules them. Stage: training engine (#187).
 */
import type { GarminClient } from "garmin-auth";
import type { QueryFn } from "./db";
import type { WorkoutStep } from "./plan-generator";

// ---- Garmin API constants ----
const STEP_TYPE_MAP: Record<string, { stepTypeId: number; stepTypeKey: string }> = {
  warmup: { stepTypeId: 1, stepTypeKey: "warmup" },
  cooldown: { stepTypeId: 2, stepTypeKey: "cooldown" },
  interval: { stepTypeId: 3, stepTypeKey: "interval" },
  recovery: { stepTypeId: 4, stepTypeKey: "recovery" },
  rest: { stepTypeId: 5, stepTypeKey: "rest" },
};
const DURATION_TYPE_MAP: Record<string, { conditionTypeId: number; conditionTypeKey: string }> = {
  time: { conditionTypeId: 2, conditionTypeKey: "time" },
  distance: { conditionTypeId: 3, conditionTypeKey: "distance" },
  lap_button: { conditionTypeId: 1, conditionTypeKey: "lap.button" },
};
const TARGET_NO_TARGET = { workoutTargetTypeId: 1, workoutTargetTypeKey: "no.target" };
const TARGET_PACE_ZONE = { workoutTargetTypeId: 6, workoutTargetTypeKey: "pace.zone" };
const TARGET_HR_ZONE = { workoutTargetTypeId: 4, workoutTargetTypeKey: "heart.rate.zone" };
const SPORT_RUNNING = { sportTypeId: 1, sportTypeKey: "running" };

function paceSecKmToMs(paceSecPerKm: number): number {
  if (paceSecPerKm <= 0) return 0.0;
  return 1000.0 / paceSecPerKm;
}

/** Convert a single workout step to Garmin's ExecutableStepDTO. Port of _build_garmin_step. */
function buildGarminStep(order: number, step: WorkoutStep): Record<string, unknown> {
  const stepType = STEP_TYPE_MAP[step.step_type] ?? STEP_TYPE_MAP.interval;

  const durationType = step.duration_type ?? "distance";
  let endCondition: { conditionTypeId: number; conditionTypeKey: string };
  let endConditionValue: number | null;
  if (durationType === "lap_button") {
    endCondition = DURATION_TYPE_MAP.lap_button;
    endConditionValue = null;
  } else {
    endCondition = DURATION_TYPE_MAP[durationType] ?? DURATION_TYPE_MAP.distance;
    endConditionValue = step.duration_value ?? 0;
  }

  const targetType = step.target_type ?? "open";
  let target: Record<string, unknown>;
  let targetValueOne: number | null;
  let targetValueTwo: number | null;
  if (targetType === "pace" && step.target_pace_min != null) {
    target = { ...TARGET_PACE_ZONE };
    // Garmin: valueOne = slower speed (m/s), valueTwo = faster speed (m/s).
    targetValueOne = paceSecKmToMs(step.target_pace_max as number); // slower pace -> lower m/s
    targetValueTwo = paceSecKmToMs(step.target_pace_min); // faster pace -> higher m/s
  } else if (targetType === "hr" && step.hr_zone != null) {
    target = { ...TARGET_HR_ZONE };
    targetValueOne = null;
    targetValueTwo = null;
  } else {
    target = { ...TARGET_NO_TARGET };
    targetValueOne = 0;
    targetValueTwo = 0;
  }

  const result: Record<string, unknown> = {
    type: "ExecutableStepDTO",
    stepOrder: order,
    stepType,
    endCondition,
    targetType: target,
    targetValueOne,
    targetValueTwo,
    description: step.description ?? "",
  };
  if (endConditionValue !== null) result.endConditionValue = endConditionValue;

  const hrZone = step.hr_zone;
  if (hrZone != null && targetType === "hr") {
    result.zoneNumber = hrZone;
  } else if (hrZone != null) {
    result.secondaryTargetType = { ...TARGET_HR_ZONE };
    result.secondaryTargetValueOne = null;
    result.secondaryTargetValueTwo = null;
    result.secondaryZoneNumber = hrZone;
  }
  return result;
}

interface RepeatItem { type: "repeat"; iterations: number; steps: WorkoutStep[]; }
type Grouped = WorkoutStep | RepeatItem;

/** Detect stride/rep patterns ("N/M") and wrap in repeat groups. Port of _detect_repeat_groups. */
function detectRepeatGroups(steps: WorkoutStep[]): Grouped[] {
  if (steps.length < 4) return steps;
  const rep = /(\d+)\/(\d+)/;
  const result: Grouped[] = [];
  let i = 0;
  while (i < steps.length) {
    const step = steps[i];
    const match = rep.exec(step.description ?? "");
    if (match && step.step_type === "interval" && Number(match[1]) === 1) {
      const totalReps = Number(match[2]);
      const pairSteps: WorkoutStep[] = [];
      let expectedIdx = 1;
      let j = i;
      while (j < steps.length && expectedIdx <= totalReps) {
        const s = steps[j];
        const sMatch = rep.exec(s.description ?? "");
        if (s.step_type === "interval" && sMatch && Number(sMatch[1]) === expectedIdx) {
          if (expectedIdx === 1) pairSteps.push(s);
          j += 1;
          if (j < steps.length && (steps[j].step_type === "recovery" || steps[j].step_type === "rest")) {
            if (expectedIdx === 1) pairSteps.push(steps[j]);
            j += 1;
          }
          expectedIdx += 1;
        } else {
          break;
        }
      }
      if (expectedIdx > totalReps && pairSteps.length >= 1) {
        result.push({ type: "repeat", iterations: totalReps, steps: pairSteps });
        i = j;
        continue;
      }
    }
    result.push(step);
    i += 1;
  }
  return result;
}

/** Convert our workout_steps to a Garmin workout API payload. Port of steps_to_garmin_workout. */
export function stepsToGarminWorkout(name: string, steps: WorkoutStep[], description = ""): Record<string, unknown> {
  const grouped = detectRepeatGroups(steps);
  const garminSteps: Record<string, unknown>[] = [];
  let order = 1;
  for (const item of grouped) {
    if ((item as RepeatItem).type === "repeat") {
      const repeat = item as RepeatItem;
      const innerSteps: Record<string, unknown>[] = [];
      let innerOrder = 1;
      for (const inner of repeat.steps) {
        innerSteps.push(buildGarminStep(innerOrder, inner));
        innerOrder += 1;
      }
      garminSteps.push({
        type: "RepeatGroupDTO",
        stepOrder: order,
        numberOfIterations: repeat.iterations,
        smartRepeat: false,
        workoutSteps: innerSteps,
      });
    } else {
      garminSteps.push(buildGarminStep(order, item as WorkoutStep));
    }
    order += 1;
  }

  const payload: Record<string, unknown> = {
    workoutName: name,
    sportType: { ...SPORT_RUNNING },
    workoutSegments: [{ segmentOrder: 1, sportType: { ...SPORT_RUNNING }, workoutSteps: garminSteps }],
  };
  if (description) payload.description = description;
  return payload;
}

const DAY_ABBREV = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** 3-letter day abbreviation from a YYYY-MM-DD date (Monday-based, matches strftime %a). */
function dayAbbrev(dateStr: string): string {
  const wd = (new Date(dateStr + "T00:00:00Z").getUTCDay() + 6) % 7; // Mon=0..Sun=6
  return DAY_ABBREV[wd];
}

export interface PushResult { pushed: number; failed: number; }

/**
 * Push all pending workout days of a plan to Garmin: build payload, upload,
 * schedule on the target date, mark garmin_push_status. Port of
 * push_plan_to_garmin. DB + EXTERNAL Garmin writes (upload + schedule).
 * Requires a GarminClient with POST support (client.post).
 */
export async function pushPlanToGarmin(sql: QueryFn, client: GarminClient, planId: number): Promise<PushResult> {
  const rows = await sql`
    SELECT id, day_date::text AS day_date, week_number, run_title, workout_steps
    FROM training_plan_day
    WHERE plan_id = ${planId}
      AND garmin_push_status IN ('none', 'pending')
      AND workout_steps IS NOT NULL
    ORDER BY day_date`;

  let pushed = 0, failed = 0;
  for (const row of rows) {
    const steps: WorkoutStep[] = typeof row.workout_steps === "string" ? JSON.parse(row.workout_steps) : row.workout_steps;
    if (!steps || !steps.length) continue;

    const workoutName = `W${row.week_number} ${dayAbbrev(row.day_date)}: ${row.run_title}`;
    const payload = stepsToGarminWorkout(workoutName, steps);

    try {
      // Upload: POST /workout-service/workout returns { workoutId }.
      const result = await client.post<{ workoutId?: number | string }>("/workout-service/workout", payload);
      const garminId = result?.workoutId != null ? String(result.workoutId) : "";

      if (garminId) {
        await client.post(`/workout-service/schedule/${garminId}`, { date: row.day_date });
      }

      await sql`
        UPDATE training_plan_day SET garmin_push_status = 'pushed', garmin_workout_id = ${garminId || null}
        WHERE id = ${row.id}`;
      pushed += 1;
    } catch (e) {
      await sql`UPDATE training_plan_day SET garmin_push_status = 'failed' WHERE id = ${row.id}`;
      console.error(`Failed to push day ${row.id} (${workoutName}): ${(e as Error).message}`);
      failed += 1;
    }
  }
  return { pushed, failed };
}
