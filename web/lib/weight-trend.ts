/**
 * Weight trend — the ground truth that survives not logging.
 *
 * Logged intake is a SAMPLED observation whose bias is exactly the logging
 * gap. Body weight is an INTEGRATED one: it reflects true energy balance over
 * the preceding days whether or not a single meal was logged. So when logging
 * coverage is thin, the scale is the only signal worth trusting, and it
 * answers the question the user actually asks, "am I in deficit", more
 * honestly than any partial log ever could (#702).
 *
 * The trend is an ordinary-least-squares slope over the trailing window,
 * reported as kg per window so the number is directly readable ("−0.4 kg over
 * 14 days"). Daily weigh-ins are noisy with water; a 14-day slope over 3+
 * points smooths that without hiding a real change.
 */
import type { QueryFn } from "@/lib/db";
import { daysBetween } from "@/lib/coverage";

export const WEIGHT_TREND_WINDOW_DAYS = 14;
/** Fewer weigh-ins than this and a slope is noise, not a trend. */
export const WEIGHT_TREND_MIN_POINTS = 3;

export interface WeighInPoint {
  date: string;
  weightKg: number;
}

export interface WeightTrend {
  /** Change over the window in kg, negative = losing. null when too few points. */
  kgPerWindow: number | null;
  windowDays: number;
  weighIns: number;
  /** First and last weigh-in dates used, or null. */
  from: string | null;
  to: string | null;
  /** Latest weigh-in in the window, or null. */
  latestKg: number | null;
  /** Plain-language line for the UI. */
  basis: string;
}

/**
 * Pure: OLS slope of weight against day-offset over the trailing window
 * ending at `today`. Points outside the window are ignored; duplicate dates
 * keep the last value.
 */
export function computeWeightTrend(
  points: WeighInPoint[],
  today: string,
  windowDays = WEIGHT_TREND_WINDOW_DAYS,
): WeightTrend {
  const byDate = new Map<string, number>();
  for (const p of points) {
    if (!Number.isFinite(p.weightKg) || p.weightKg <= 0) continue;
    const back = daysBetween(p.date, today);
    if (back < 0 || back >= windowDays) continue;
    byDate.set(p.date, p.weightKg);
  }
  const xs: number[] = [];
  const ys: number[] = [];
  const dates = [...byDate.keys()].sort();
  for (const d of dates) {
    xs.push(-daysBetween(d, today)); // 0 = today, negative = past
    ys.push(byDate.get(d)!);
  }
  const n = xs.length;
  const latestKg = n ? ys[n - 1] : null;

  if (n < WEIGHT_TREND_MIN_POINTS) {
    return {
      kgPerWindow: null,
      windowDays,
      weighIns: n,
      from: n ? dates[0] : null,
      to: n ? dates[n - 1] : null,
      latestKg,
      basis: n === 0
        ? `no weigh-ins in the last ${windowDays} days`
        : `${n} weigh-in${n === 1 ? "" : "s"} in the last ${windowDays} days; ${WEIGHT_TREND_MIN_POINTS} needed for a trend`,
    };
  }

  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) * (xs[i] - mx);
  }
  // All weigh-ins on one day: no slope is defined.
  if (sxx === 0) {
    return { kgPerWindow: null, windowDays, weighIns: n, from: dates[0], to: dates[n - 1], latestKg,
      basis: `${n} weigh-ins on a single day; no trend` };
  }
  const slopePerDay = sxy / sxx;
  const kgPerWindow = Math.round(slopePerDay * windowDays * 100) / 100;
  const sign = kgPerWindow > 0 ? "+" : "";
  return {
    kgPerWindow,
    windowDays,
    weighIns: n,
    from: dates[0],
    to: dates[n - 1],
    latestKg,
    basis: `${sign}${kgPerWindow.toFixed(1)} kg over ${windowDays} days (${n} weigh-ins)`,
  };
}

export async function getWeightTrend(sql: QueryFn, today: string, windowDays = WEIGHT_TREND_WINDOW_DAYS): Promise<WeightTrend> {
  try {
    const rows = (await sql`
      SELECT date::text AS date, weight_grams / 1000.0 AS weight_kg
      FROM weight_log
      WHERE weight_grams IS NOT NULL
        AND date >= ${today}::date - ${`${windowDays} days`}::interval
        AND date <= ${today}::date
      ORDER BY date
    `) as unknown as { date: string; weight_kg: number }[];
    return computeWeightTrend(rows.map((r) => ({ date: r.date, weightKg: Number(r.weight_kg) })), today, windowDays);
  } catch {
    return computeWeightTrend([], today, windowDays);
  }
}
