/**
 * The one place that decides whether a training plan is LIVE.
 *
 * Four routes used to join `training_plan WHERE status = 'active'` directly and
 * anchor everything to whatever row that returned. Today that row is the
 * Knoxville HM plan, race 2026-04-12, five months gone, still flagged active
 * (#701). "Active" is a flag nobody flipped, not a fact about the athlete.
 *
 * Every route now goes through `getLivePlan`, which applies the calibrated
 * rule from lib/engagement: live = active AND a session within ±7 days AND
 * trailing-14-day completion ≥ 25%. When no plan is live the routes get
 * `plan: null, days: []` plus the engagement object explaining why, and fall
 * back to what Garmin actually observed instead of a phantom script.
 */
import type { QueryFn } from "@/lib/db";
import { todayAthlete } from "./athlete-tz";
import { trainingEngagement, type PlanInput, type TrainingEngagement } from "@/lib/engagement";

export interface PlanRow {
  id: number;
  plan_name: string | null;
  race_date: string | null;
  goal_time_seconds: number | null;
  status: string | null;
}

/** Superset of the columns the four consuming routes read. */
export interface PlanDayRow {
  id: number;
  day_date: string;
  week_number: number | null;
  run_type: string | null;
  run_title: string | null;
  target_distance_km: number | null;
  target_duration_min: number | null;
  workout_steps: unknown;
  load_level: string | null;
  gym_workout: unknown;
  gym_notes: string | null;
  completed: boolean | null;
  garmin_workout_id: string | null;
  garmin_push_status: string | null;
  actual_distance_km: number | null;
}

export interface LivePlan {
  engagement: TrainingEngagement;
  /** Non-null only when the plan is live. */
  plan: PlanRow | null;
  /** Empty unless the plan is live. */
  days: PlanDayRow[];
}

/** Today in the athlete's timezone as YYYY-MM-DD; matches graph/route.ts. */
export function todayLocal(): string {
  return todayAthlete();
}

/**
 * Pure: apply the live rule to an already-fetched plan and its days.
 * Exposed for table tests; `getLivePlan` is the SQL wrapper.
 */
export function resolveLivePlan(plan: PlanRow | null, days: PlanDayRow[], today: string): LivePlan {
  const input: PlanInput | null = plan
    ? { status: plan.status, planName: plan.plan_name, raceDate: plan.race_date }
    : null;
  const engagement = trainingEngagement(
    input,
    days.map((d) => ({ day_date: d.day_date, run_type: d.run_type, completed: d.completed })),
    today,
  );
  if (!engagement.planLive || !plan) return { engagement, plan: null, days: [] };
  return { engagement, plan, days };
}

export async function getLivePlan(sql: QueryFn, today: string = todayLocal()): Promise<LivePlan> {
  let plan: PlanRow | null = null;
  let days: PlanDayRow[] = [];
  try {
    const rows = (await sql`
      SELECT id, plan_name, race_date::text AS race_date, goal_time_seconds, status
      FROM training_plan WHERE status = 'active'
      ORDER BY created_at DESC LIMIT 1
    `) as unknown as PlanRow[];
    plan = rows[0] ?? null;
    if (plan) {
      days = (await sql`
        SELECT id, day_date::text AS day_date, week_number, run_type, run_title,
               target_distance_km, target_duration_min, workout_steps, load_level,
               gym_workout, gym_notes, completed, garmin_workout_id,
               garmin_push_status, actual_distance_km
        FROM training_plan_day
        WHERE plan_id = ${plan.id}
        ORDER BY day_date
      `) as unknown as PlanDayRow[];
    }
  } catch {
    // training tables may not exist (demo DB): behave as "no plan", not as an error
  }
  return resolveLivePlan(plan, days, today);
}

/**
 * What the athlete has actually been doing, for the no-plan fallback: mean
 * daily Garmin load over the trailing window, and how many days carried load.
 * "If you keep doing what you're doing" is projected from this, and the UI
 * must label it as such rather than as a prescription.
 */
export interface TrailingLoad {
  windowDays: number;
  meanDailyLoad: number;
  activeDays: number;
}

export function summariseTrailingLoad(
  rows: { date: string; daily_load: number | null }[],
  today: string,
  windowDays = 28,
): TrailingLoad {
  const cutoff = shiftDate(today, -(windowDays - 1));
  const inWindow = rows.filter((r) => r.date >= cutoff && r.date <= today);
  const loads = inWindow.map((r) => Number(r.daily_load) || 0);
  const total = loads.reduce((s, v) => s + v, 0);
  return {
    windowDays,
    meanDailyLoad: windowDays > 0 ? total / windowDays : 0,
    activeDays: loads.filter((v) => v > 0).length,
  };
}

export async function getTrailingLoad(sql: QueryFn, today: string = todayLocal(), windowDays = 28): Promise<TrailingLoad> {
  try {
    const rows = (await sql`
      SELECT date::text AS date, daily_load FROM pmc_daily
      WHERE date >= ${today}::date - ${`${windowDays} days`}::interval AND date <= ${today}::date
      ORDER BY date
    `) as unknown as { date: string; daily_load: number | null }[];
    return summariseTrailingLoad(rows, today, windowDays);
  } catch {
    return { windowDays, meanDailyLoad: 0, activeDays: 0 };
  }
}

function shiftDate(iso: string, days: number): string {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
