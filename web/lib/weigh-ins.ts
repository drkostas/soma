/**
 * Shared reading of weigh-ins, so the typo filter cannot be wired into some readers and not others.
 *
 * ⛔ FIVE PLACES QUERY `weight_log` WITH THEIR OWN SQL: the trend, the adaptive TDEE, the body
 * composition stream, the fitness stream and the agent's context. Filtering one of them would have
 * been the "it exists but nothing calls it" defect again, which has already been found six times in
 * this ecosystem. Each keeps its own query, because their date windows differ and changing those
 * would be a behaviour change smuggled in beside a bug fix, but they all pass through `keepPlausible`.
 *
 * ⛔ AND `ORDER BY date DESC LIMIT 1` IS THE DANGEROUS SHAPE. Two readers wanted "his current weight"
 * and took the newest row, so one mistyped weigh-in would become his current weight until the next
 * arrived. Judging a reading needs its neighbours, so `latestWeighIn` reads a window and takes the
 * newest survivor rather than asking the database for a single row.
 *
 * See `weight-plausibility.ts` for where the 3 kg threshold comes from, and why a hand-entered
 * weigh-in is a real one.
 */
import type { QueryFn } from "./db";
import { flagOutliers, type WeighIn } from "./weight-plausibility";

export type { WeighIn } from "./weight-plausibility";

/**
 * How far back `latestWeighIn` looks for neighbours to judge the newest reading against.
 *
 * Wide enough that a sparse stretch still gives it something to compare with, and his log has months
 * holding one or two. A reading with no neighbours inside the window is kept, which is the right
 * answer when there is nothing to compare it with.
 */
export const NEIGHBOUR_WINDOW_DAYS = 90;

/**
 * Drop the implausible weigh-ins and say which, so a discard can be checked rather than trusted.
 *
 * A silent discard is worse to debug later than a loud one: the trend would simply differ from the
 * log with nothing to explain why.
 */
export function keepPlausible(rows: readonly WeighIn[], where: string): WeighIn[] {
  const { kept, discarded } = flagOutliers(rows);
  for (const d of discarded) {
    console.warn(
      `[${where}] discarding the weigh-in on ${d.date} at ${d.weightKg} kg, ` +
        `${d.offByKg} kg from its neighbours' median of ${d.localMedianKg} kg`,
    );
  }
  return kept;
}

/**
 * His most recent plausible weigh-in on or before a date, or null when there is none at all.
 *
 * Returns null rather than a number it does not believe. Both callers already handle having no
 * weight, and a wrong weight is worse than a missing one, because the VDOT and the race prediction
 * are computed from it.
 */
export async function latestWeighIn(
  sql: QueryFn,
  onOrBefore: string,
  where: string,
): Promise<WeighIn | null> {
  const rows = (await sql`
    SELECT date::text AS date, weight_grams / 1000.0 AS weight_kg, body_fat_pct
    FROM weight_log
    WHERE weight_grams IS NOT NULL AND weight_grams > 0
      AND date <= ${onOrBefore}::date
      AND date >= ${onOrBefore}::date - ${`${NEIGHBOUR_WINDOW_DAYS} days`}::interval
    ORDER BY date
  `) as unknown as { date: string; weight_kg: number; body_fat_pct: number | null }[];

  if (rows.length) {
    const kept = keepPlausible(
      rows.map((r) => ({
        date: r.date,
        weightKg: Number(r.weight_kg),
        bodyFatPct: r.body_fat_pct === null ? null : Number(r.body_fat_pct),
      })),
      where,
    );
    if (kept.length) return kept[kept.length - 1];
    return null;
  }

  // Nothing recent enough to have neighbours. Take the newest there is and say so, rather than
  // reporting no weight for someone with four years of them. This is his situation today: the last
  // real weigh-in is months old.
  const fallback = (await sql`
    SELECT date::text AS date, weight_grams / 1000.0 AS weight_kg, body_fat_pct
    FROM weight_log
    WHERE weight_grams IS NOT NULL AND weight_grams > 0 AND date <= ${onOrBefore}::date
    ORDER BY date DESC LIMIT 1
  `) as unknown as { date: string; weight_kg: number; body_fat_pct: number | null }[];
  if (!fallback.length) return null;
  console.warn(
    `[${where}] the newest weigh-in is ${fallback[0].date}, over ${NEIGHBOUR_WINDOW_DAYS} days old, so it was taken unjudged`,
  );
  return {
    date: fallback[0].date,
    weightKg: Number(fallback[0].weight_kg),
    bodyFatPct: fallback[0].body_fat_pct === null ? null : Number(fallback[0].body_fat_pct),
  };
}
