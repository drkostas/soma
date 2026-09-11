/** Body-comp stream, DB half: weight EMA and the weight-adjusted VDOT into the tables. computeWeightEma lives in banister. */
import type { QueryFn } from "./db";
import { DEFAULT_CALIBRATION_WEIGHT_KG, computeWeightEma } from "banister";
import { adjustVdotForWeight, timeFromVdot, HM_M, type BodyComp } from "banister";
const r = (x: number, n: number) => Number(x.toFixed(n)); // Python round(x, n) for n>=1
export { DEFAULT_CALIBRATION_WEIGHT_KG, computeWeightEma } from "banister";
export type { WeightEmaPoint, BodyComp } from "banister";

/**
 * Compute 7-day weight EMA + weight-adjusted VDOT for a date, upsert into
 * fitness_trajectory (weight_kg overwrite; vdot_adjusted / race COALESCE-preserve).
 * Port of update_body_comp. Returns the result, or null if no weight data. DB.
 */
export async function updateBodyComp(
  sql: QueryFn,
  targetDate: string,
  calibrationWeightKg = DEFAULT_CALIBRATION_WEIGHT_KG,
): Promise<BodyComp | null> {
  const startDate = new Date(Date.parse(targetDate + "T00:00:00Z") - 29 * 86_400_000).toISOString().slice(0, 10);

  const rows = await sql`
    SELECT date::text AS date, weight_grams / 1000.0 AS weight_kg
    FROM weight_log
    WHERE date BETWEEN ${startDate} AND ${targetDate}
      AND weight_grams IS NOT NULL AND weight_grams > 0
    ORDER BY date`;
  if (!rows.length) return null;

  const weights: Array<[string, number]> = rows.map((row) => [row.date, Number(row.weight_kg)]);
  const emaResults = computeWeightEma(weights, 7);
  if (!emaResults.length) return null;

  const currentEma = emaResults[emaResults.length - 1].weight_ema;
  const calibrationWeight = calibrationWeightKg;

  const vRows = await sql`
    SELECT vo2max FROM fitness_trajectory
    WHERE date <= ${targetDate} AND vo2max IS NOT NULL
    ORDER BY date DESC LIMIT 1`;
  const vdotBase = vRows.length ? Number(vRows[0].vo2max) : null;

  let vdotAdjusted: number | null = null;
  if (vdotBase !== null) vdotAdjusted = r(adjustVdotForWeight(vdotBase, calibrationWeight, currentEma), 2);

  let racePredictionSeconds: number | null = null;
  const effectiveVdot = vdotAdjusted ?? vdotBase;
  if (effectiveVdot !== null && effectiveVdot > 0) {
    racePredictionSeconds = Math.round(timeFromVdot(effectiveVdot, HM_M));
  }

  const result: BodyComp = {
    date: targetDate,
    weight_kg: r(currentEma, 2),
    weight_raw: emaResults[emaResults.length - 1].weight_raw,
    vdot_base: vdotBase,
    vdot_adjusted: vdotAdjusted,
    race_prediction_seconds: racePredictionSeconds,
    calibration_weight_kg: calibrationWeight,
    ema_points: emaResults.length,
  };

  await sql`
    INSERT INTO fitness_trajectory (date, weight_kg, vdot_adjusted, race_prediction_seconds, computed_at)
    VALUES (${result.date}, ${result.weight_kg}, ${result.vdot_adjusted}, ${result.race_prediction_seconds}, NOW())
    ON CONFLICT (date) DO UPDATE SET
      weight_kg = EXCLUDED.weight_kg,
      vdot_adjusted = COALESCE(EXCLUDED.vdot_adjusted, fitness_trajectory.vdot_adjusted),
      race_prediction_seconds = COALESCE(EXCLUDED.race_prediction_seconds, fitness_trajectory.race_prediction_seconds),
      computed_at = NOW()`;
  return result;
}
