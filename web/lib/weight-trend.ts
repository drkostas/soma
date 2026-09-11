/** Weight trend, DB half: read the weigh-ins and hand them to banister's computeWeightTrend. */
import type { QueryFn } from "./db";
import type { WeightTrend } from "banister";
import { WEIGHT_TREND_WINDOW_DAYS, WEIGHT_TREND_MIN_POINTS, computeWeightTrend } from "banister";
export { WEIGHT_TREND_WINDOW_DAYS, WEIGHT_TREND_MIN_POINTS, computeWeightTrend } from "banister";
export type { WeighInPoint, WeightTrend } from "banister";

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
