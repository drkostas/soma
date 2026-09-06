/**
 * Engagement — does a module actually have the user's data, or is it assuming?
 *
 * Every derived number in soma has an implicit coverage: the fraction of its
 * inputs that were observed rather than assumed. Pages used to render as if
 * that were always 100%. Readiness was the first fix (stale sleep no longer
 * fabricates a green; it says "unknown"). This module generalises it: each
 * module answers one small question, and every page gates on the answer.
 *
 * Four states, kept distinct on purpose:
 *   absent   — nothing observed. Unknown, not zero.
 *   partial  — something observed, known incomplete.
 *   complete — enough observed to trust the module's inferences.
 *   dormant  — a script exists (a plan) but the user is not living by it.
 *
 * Pure functions over already-fetched rows so they are trivially table-tested;
 * the thin SQL loaders live next to them. Thresholds are calibrated from the
 * user's own history (#698), not guessed, and are exported so the UI can quote
 * the basis rather than the number.
 */
import { meetsCoverageFloor, daysBetween } from "@/lib/coverage";

export type EngagementState = "absent" | "partial" | "complete" | "dormant";

export interface Engagement {
  state: EngagementState;
  /** 0..1, how much of the window was observed at a trustworthy level. */
  coverage: number;
  /** Plain-language basis, for the UI to show instead of a bare number. */
  basis: string;
}

// ── Nutrition ────────────────────────────────────────────────────────────────

/**
 * Complete days a week needs before its inferences (adherence, deficit streak,
 * adaptive TDEE) are worth showing. Calibrated: the user logged 3+ of 4 slots
 * on 33 of 48 closed days when actively using nutrition (Mar–Apr 2026).
 */
export const WEEK_ENGAGEMENT_FLOOR_DAYS = 3;
export const WEEK_WINDOW_DAYS = 7;

export interface NutritionDayInput {
  date: string;
  status: string | null;
  /** Logging coverage 0..1 from lib/coverage, or null when unknown. */
  coverage: number | null;
}

/** A single day: complete when closed at the floor; partial when anything was logged. */
export function nutritionDayState(d: NutritionDayInput): Exclude<EngagementState, "dormant"> {
  if (d.status === "closed" && meetsCoverageFloor(d.coverage)) return "complete";
  if (typeof d.coverage === "number" && d.coverage > 0) return "partial";
  return "absent";
}

/**
 * Week-level engagement ending at `today`, inclusive. Rows outside the window
 * are ignored so callers can pass whatever they already fetched.
 */
export function nutritionEngagement(days: NutritionDayInput[], today: string): Engagement {
  const inWindow = days.filter((d) => {
    const back = daysBetween(d.date, today);
    return back >= 0 && back < WEEK_WINDOW_DAYS;
  });
  let complete = 0;
  let partial = 0;
  for (const d of inWindow) {
    const s = nutritionDayState(d);
    if (s === "complete") complete++;
    else if (s === "partial") partial++;
  }
  const coverage = complete / WEEK_WINDOW_DAYS;
  if (complete >= WEEK_ENGAGEMENT_FLOOR_DAYS) {
    return { state: "complete", coverage, basis: `${complete} of ${WEEK_WINDOW_DAYS} days fully logged` };
  }
  if (complete > 0 || partial > 0) {
    const bits = [];
    if (complete > 0) bits.push(`${complete} fully logged`);
    if (partial > 0) bits.push(`${partial} partly logged`);
    return {
      state: "partial",
      coverage,
      basis: `${bits.join(", ")} of the last ${WEEK_WINDOW_DAYS} days; ${WEEK_ENGAGEMENT_FLOOR_DAYS} full days needed`,
    };
  }
  return { state: "absent", coverage: 0, basis: `nothing logged in the last ${WEEK_WINDOW_DAYS} days` };
}

// ── Training ─────────────────────────────────────────────────────────────────

/**
 * A plan is LIVE only when the user is living by it, not merely when a status
 * flag says 'active'. Calibrated: the Knoxville HM plan was followed at 32% in
 * its best month, so 25% is the floor for "following". ±7 days is the window
 * in which a plan has to have prescribed something to count as current.
 */
export const PLAN_LIVE_WINDOW_DAYS = 7;
export const PLAN_TRAILING_DAYS = 14;
export const PLAN_COMPLETION_FLOOR = 0.25;

export interface PlanInput {
  status: string | null;
  planName: string | null;
  raceDate: string | null;
}

export interface PlanDayInput {
  day_date: string;
  run_type: string | null;
  completed: boolean | null;
}

export interface TrainingEngagement extends Engagement {
  planLive: boolean;
  planName: string | null;
  /** Prescribed non-rest days in the trailing window that were completed, 0..1, or null when none prescribed. */
  trailingCompletion: number | null;
}

export function trainingEngagement(
  plan: PlanInput | null,
  days: PlanDayInput[],
  today: string,
): TrainingEngagement {
  if (!plan || plan.status !== "active") {
    return {
      state: "absent",
      coverage: 0,
      basis: "no active training plan",
      planLive: false,
      planName: plan?.planName ?? null,
      trailingCompletion: null,
    };
  }

  const nearby = days.some((d) => Math.abs(daysBetween(d.day_date, today)) <= PLAN_LIVE_WINDOW_DAYS);
  const trailing = days.filter((d) => {
    const back = daysBetween(d.day_date, today);
    return back >= 0 && back < PLAN_TRAILING_DAYS && d.run_type !== "rest";
  });
  const trailingCompletion = trailing.length
    ? trailing.filter((d) => d.completed === true).length / trailing.length
    : null;

  if (!nearby) {
    const ended = plan.raceDate ? ` (race ${plan.raceDate})` : "";
    return {
      state: "dormant",
      coverage: 0,
      basis: `${plan.planName ?? "plan"} has no sessions within ${PLAN_LIVE_WINDOW_DAYS} days${ended}`,
      planLive: false,
      planName: plan.planName,
      trailingCompletion,
    };
  }

  // Nearby days but nothing prescribed yet in the trailing window (brand-new
  // plan): live, and not penalised for having no history.
  if (trailingCompletion === null) {
    return {
      state: "complete",
      coverage: 1,
      basis: `${plan.planName ?? "plan"} is current; no sessions due yet`,
      planLive: true,
      planName: plan.planName,
      trailingCompletion,
    };
  }

  const pct = Math.round(trailingCompletion * 100);
  if (trailingCompletion >= PLAN_COMPLETION_FLOOR) {
    return {
      state: "complete",
      coverage: trailingCompletion,
      basis: `${pct}% of planned sessions done in the last ${PLAN_TRAILING_DAYS} days`,
      planLive: true,
      planName: plan.planName,
      trailingCompletion,
    };
  }
  return {
    state: "partial",
    coverage: trailingCompletion,
    basis: `plan exists but ${pct}% of planned sessions done in the last ${PLAN_TRAILING_DAYS} days`,
    planLive: false,
    planName: plan.planName,
    trailingCompletion,
  };
}
