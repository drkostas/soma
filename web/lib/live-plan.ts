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
  /** Set when the user dropped the plan (soma#926); the rows stay as history. */
  dropped_at?: string | null;
  created_at?: string | null;
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

/**
 * A plan day plus the plan header fields a page attaches before rendering.
 *
 * `day_of_week` and `run_description` are columns of `training_plan_day` that `getLivePlan`
 * does not select, so they are optional here: a consumer that renders them gets nothing unless
 * it queried the table itself.
 */
export type PlanDayWithPlan = PlanDayRow & {
  plan_name: string | null;
  race_date: string | null;
  goal_time_seconds: number | null;
  day_of_week?: number | null;
  run_description?: string | null;
};

export interface LivePlan {
  engagement: TrainingEngagement;
  /** Non-null only when the plan is live. */
  plan: PlanRow | null;
  /** Empty unless the plan is live. */
  days: PlanDayRow[];
}

/**
 * Today in the FALLBACK timezone as YYYY-MM-DD.
 *
 * ⚠️ NOT FOR A REQUEST. A route or a page should use `todayForRequest()`, which reads the zone the
 * device sent; this is the constant, for the drain and the daemons that have no device to ask. Its
 * one caller was a route and has been moved.
 */
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
      SELECT id, plan_name, race_date::text AS race_date, goal_time_seconds, status,
             dropped_at::text AS dropped_at, created_at::text AS created_at
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

/**
 * The lifecycle of a plan, from facts (soma#926):
 *   live      the engagement rule says the athlete is on it
 *   paused    it exists and its race is ahead, but no session in 7 days or too
 *             few done; the next session revives it, nothing to click
 *   finished  its race date has passed; the sessions done stay as history
 *   dropped   the user said so (dropped_at), or a newer plan superseded it
 *   none      there is no plan
 * "active" in the status column is how creation keeps one current plan; it is
 * not a fact about the athlete, which is why the state is derived here.
 */
export type PlanState = "none" | "live" | "paused" | "finished" | "dropped";

export interface PlanSummary {
  id: number;
  name: string | null;
  raceDate: string | null;
  goalTimeSeconds: number | null;
  createdAt: string | null;
  droppedAt: string | null;
  state: PlanState;
  /** Non-rest days the plan prescribes, and how many of them were completed. */
  sessionsPlanned: number;
  sessionsDone: number;
  /** Pushed workouts dated today or later, the ones a drop removes from Garmin. */
  pushedAhead: number;
  /** Why the engagement rule reads it the way it does, for the UI to quote. */
  basis: string;
}

export function planState(plan: PlanRow | null, engagement: TrainingEngagement, today: string): PlanState {
  if (!plan) return "none";
  if (plan.dropped_at || plan.status === "dropped") return "dropped";
  const raceGone = !!plan.race_date && plan.race_date < today;
  if (plan.status !== "active") return raceGone ? "finished" : "dropped"; // superseded by a newer plan
  if (raceGone) return "finished";
  return engagement.planLive ? "live" : "paused";
}

export function summarisePlan(plan: PlanRow, days: PlanDayRow[], today: string): PlanSummary {
  const engagement = trainingEngagement(
    { status: plan.status, planName: plan.plan_name, raceDate: plan.race_date },
    days.map((d) => ({ day_date: d.day_date, run_type: d.run_type, completed: d.completed })),
    today,
  );
  const sessions = days.filter((d) => d.run_type !== "rest");
  return {
    id: plan.id,
    name: plan.plan_name,
    raceDate: plan.race_date,
    goalTimeSeconds: plan.goal_time_seconds,
    createdAt: plan.created_at ?? null,
    droppedAt: plan.dropped_at ?? null,
    state: planState(plan, engagement, today),
    sessionsPlanned: sessions.length,
    sessionsDone: sessions.filter((d) => d.completed === true).length,
    pushedAhead: days.filter((d) => d.garmin_push_status === "pushed" && !!d.garmin_workout_id && d.day_date >= today).length,
    basis: engagement.basis,
  };
}

export interface PlanLifecycle {
  /** The plan creation keeps current (status active), whatever its state; null when there is none. */
  current: PlanSummary | null;
  /** Every other plan, newest first. */
  past: PlanSummary[];
}

/** Every plan with its state, for the Training page's header, Past plans and the app's plan card. */
export async function getPlanLifecycle(sql: QueryFn, today: string = todayLocal()): Promise<PlanLifecycle> {
  try {
    const plans = (await sql`
      SELECT id, plan_name, race_date::text AS race_date, goal_time_seconds, status,
             dropped_at::text AS dropped_at, created_at::text AS created_at
      FROM training_plan ORDER BY created_at DESC
    `) as unknown as PlanRow[];
    if (!plans.length) return { current: null, past: [] };
    const days = (await sql`
      SELECT id, plan_id, day_date::text AS day_date, week_number, run_type, run_title,
             target_distance_km, target_duration_min, workout_steps, load_level,
             gym_workout, gym_notes, completed, garmin_workout_id,
             garmin_push_status, actual_distance_km
      FROM training_plan_day ORDER BY day_date
    `) as unknown as (PlanDayRow & { plan_id: number })[];
    const summaries = plans.map((p) => summarisePlan(p, days.filter((d) => d.plan_id === p.id), today));
    const current = summaries.find((s) => plans.find((p) => p.id === s.id)?.status === "active") ?? null;
    return { current, past: summaries.filter((s) => s.id !== current?.id) };
  } catch {
    return { current: null, past: [] };
  }
}
