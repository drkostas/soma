/**
 * Adaptive TDEE + deficit-duration — wires macro-engine-core's adaptive engine
 * into soma. Display-only: it surfaces how the body's effective TDEE has drifted
 * from the reported figure and whether a diet break is due. It never changes the
 * day's targets (the user decides).
 *
 * No schema change: DayPoints come from `nutrition_day` (intake, tdee) joined to
 * `weight_log` (weight), and the deficit-phase duration is counted from
 * consecutive recent deficit days that aren't diet breaks / refeeds.
 */
import { computeAdaptiveTdee, recommendDietBreak, type DietBreakLevel } from "macro-engine-core";
import type { QueryFn } from "@/lib/db";
import { meetsCoverageFloor, daysBetween, STREAK_MAX_GAP_DAYS } from "@/lib/coverage";

export interface AdaptiveContext {
  effectiveTdee: number;
  reportedTdee: number;
  discrepancyPct: number;
  driftFlag: boolean;
  deficitDurationDays: number;
  dietBreakLevel: DietBreakLevel;
}

interface DayRow {
  date: string;
  actual_calories: number | null;
  tdee_used: number | null;
  target_calories: number | null;
  deficit_used: number | null;
  is_diet_break: boolean | null;
  is_refeed: boolean | null;
  status: string | null;
  /**
   * Logging coverage 0..1 (see lib/coverage). A closed day below the floor is
   * ABSENT data wearing a "closed" badge: it contributes nothing, exactly like
   * an unclosed day. `null` means unknown and also contributes nothing.
   */
  coverage: number | null;
}

/**
 * A day counts toward any inference only when it is closed AND its logging
 * coverage clears the floor. This is the single guard behind #699: the 53
 * May–Jun 2026 days that were closed with zero meal_log rows fail it.
 */
function contributes(r: DayRow): boolean {
  return r.status === "closed" && meetsCoverageFloor(r.coverage);
}

// How far back to look. 130 days covers the diet-break ceiling (112) for the
// duration count; the adaptive-TDEE window itself is only the last 14.
const LOOKBACK_DAYS = 130;

/**
 * Count consecutive closed deficit days ending at the most recent day, stopping
 * at the first diet break, refeed, or non-deficit day. This is the length of the
 * current deficit phase.
 */
export function countDeficitDuration(rows: DayRow[]): number {
  let n = 0;
  let lastCounted: string | null = null;
  const latest = rows.length ? rows[rows.length - 1].date : null;
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    // Unclosed AND low-coverage days are both absent data: skip without
    // breaking, but they still consume calendar distance (see gap rule).
    if (!contributes(r)) continue;
    // Gap rule: a "consecutive" phase cannot span more than STREAK_MAX_GAP_DAYS
    // of absent data. Without it the walk-back crosses four empty months and
    // reports last spring's deficit as the current phase.
    const anchor = lastCounted ?? latest;
    if (anchor && daysBetween(r.date, anchor) > STREAK_MAX_GAP_DAYS) break;
    if (r.is_diet_break || r.is_refeed) break;
    if ((Number(r.deficit_used) || 0) <= 0) break;
    n++;
    lastCounted = r.date;
  }
  return n;
}

export interface WeighIn {
  date: string;
  weightKg: number;
}

/**
 * Build the DayPoints the adaptive engine needs: last-N closed days with a real
 * intake, each carrying a forward-filled body weight. Weigh-ins rarely land on
 * the same dates as nutrition days, so we merge-walk the sorted weigh-ins and
 * carry the most recent weight at or before each day.
 */
export function buildDayPoints(
  rows: DayRow[],
  weights: WeighIn[],
): { day: number; intakeKcal: number; tdeeKcal: number; weightKg: number }[] {
  const points: { day: number; intakeKcal: number; tdeeKcal: number; weightKg: number }[] = [];
  let lastWeight = 0;
  let wi = 0;
  let idx = 0;
  for (const r of rows) {
    while (wi < weights.length && weights[wi].date <= r.date) {
      if (weights[wi].weightKg > 0) lastWeight = weights[wi].weightKg;
      wi++;
    }
    if (!contributes(r)) continue;
    const intake = Number(r.actual_calories) || 0;
    if (intake <= 0) continue;
    if (lastWeight <= 0) continue; // no weigh-in yet — skip until we have one
    // tdee: prefer the stored figure, else reconstruct target + deficit
    const tdee = Number(r.tdee_used) || (Number(r.target_calories) || 0) + (Number(r.deficit_used) || 0);
    if (tdee <= 0) continue;
    points.push({ day: idx++, intakeKcal: intake, tdeeKcal: tdee, weightKg: lastWeight });
  }
  return points;
}

export async function computeAdaptiveContext(sql: QueryFn): Promise<AdaptiveContext | null> {
  // Coverage = (distinct slots with logged kcal ∪ explicitly skipped slots) / 4.
  // Computed in SQL so every consumer of these rows sees the same number.
  // Only the four canonical slots count; a slot both logged and skipped
  // counts once (the UNION dedupes).
  const rows = (await sql`
    SELECT n.date::text AS date, n.actual_calories, n.tdee_used, n.target_calories,
           n.deficit_used, n.is_diet_break, n.is_refeed, n.status,
           (
             SELECT COUNT(DISTINCT s)::float / 4
             FROM (
               SELECT m.meal_slot AS s FROM meal_log m
                WHERE m.date = n.date AND m.calories > 0
               UNION
               SELECT unnest(COALESCE(n.skipped_slots, ARRAY[]::text[]))
             ) u
             WHERE u.s IN ('breakfast', 'lunch', 'dinner', 'pre_sleep')
           ) AS coverage
    FROM nutrition_day n
    WHERE n.date >= CURRENT_DATE - ${`${LOOKBACK_DAYS} days`}::interval
    ORDER BY n.date
  `) as unknown as DayRow[];
  if (!rows.length) return null;

  const weightRows = (await sql`
    SELECT date::text AS date, weight_grams / 1000.0 AS weight_kg
    FROM weight_log
    WHERE weight_grams IS NOT NULL
      AND date >= CURRENT_DATE - ${`${LOOKBACK_DAYS} days`}::interval
    ORDER BY date
  `) as unknown as { date: string; weight_kg: number }[];
  const weights: WeighIn[] = weightRows.map((w) => ({ date: w.date, weightKg: Number(w.weight_kg) }));

  const days = buildDayPoints(rows, weights);
  const adaptive = computeAdaptiveTdee(days);
  if (!adaptive) return null;

  const deficitDurationDays = countDeficitDuration(rows);
  return {
    ...adaptive,
    deficitDurationDays,
    dietBreakLevel: recommendDietBreak(deficitDurationDays),
  };
}
