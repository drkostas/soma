/**
 * Body-comp stream — TS port of sync/src/training_engine/body_comp_stream.py.
 * Smooths weight with a 7-day EMA and derives a weight-adjusted VDOT + race
 * prediction, upserted into fitness_trajectory. Pure EMA + one DB step; reuses
 * the ported vdot helpers. Stage: training engine (#187). DB-only.
 *
 * VDOT_adj = VDOT_base × (calibration_weight / current_weight): lighter = faster.
 */
import type { QueryFn } from "./db";
import { adjustVdotForWeight, timeFromVdot } from "./vdot";

const HM_DISTANCE_M = 21097.5;

/**
 * Python round() parity. toFixed matches CPython's round-half-to-even
 * everywhere EXCEPT an exact binary tie (e.g. 80.125 → toFixed 80.13, Python
 * 80.12). Clean weight inputs can produce such a tie, so detect it (x·2·10^n is
 * an odd integer) and round half to even; otherwise delegate to toFixed.
 */
const r = (x: number, n: number): number => {
  const m = 10 ** n;
  const twice = x * 2 * m;
  if (Number.isInteger(twice) && Math.abs(twice) % 2 === 1) {
    const floor = Math.floor(x * m);
    return (floor % 2 === 0 ? floor : floor + 1) / m; // ties to even
  }
  return Number(x.toFixed(n));
};

// Athlete's weight at the VDOT 47 calibration (5K PR, 2026-03-07).
export const DEFAULT_CALIBRATION_WEIGHT_KG = 80.5;

export interface WeightEmaPoint { date: string; weight_raw: number; weight_ema: number; }

/** Exponential moving average of (date, weight) pairs; alpha = 2/(span+1). */
export function computeWeightEma(weights: Array<[string, number]>, span = 7): WeightEmaPoint[] {
  const alpha = 2.0 / (span + 1);
  const results: WeightEmaPoint[] = [];
  let ema: number | null = null;
  for (const [dt, w] of weights) {
    ema = ema === null ? w : w * alpha + ema * (1 - alpha);
    results.push({ date: dt, weight_raw: w, weight_ema: r(ema, 2) });
  }
  return results;
}

export interface BodyComp {
  date: string;
  weight_kg: number;
  weight_raw: number;
  vdot_base: number | null;
  vdot_adjusted: number | null;
  race_prediction_seconds: number | null;
  calibration_weight_kg: number;
  ema_points: number;
}

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
    racePredictionSeconds = Math.round(timeFromVdot(effectiveVdot, HM_DISTANCE_M));
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
