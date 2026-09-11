/** Fitness stream, DB half: fill fitness_trajectory from the Garmin raw tables. The formulas live in banister. */
import type { QueryFn } from "./db";
import { computeEfficiencyFactor, computeDecoupling, extractVo2max, aggregateLaps, splitIntoHalves } from "banister";
import { timeFromVdot, HM_M, type FitnessTrajectory } from "banister";
const r = (x: number, n: number) => Number(x.toFixed(n)); // Python round(x, n) for n>=1
export { computeEfficiencyFactor, computeDecoupling, extractVo2max, aggregateLaps, splitIntoHalves } from "banister";
export type { Half, FitnessTrajectory } from "banister";

/**
 * Compute + upsert fitness_trajectory for a date. Port of update_fitness_trajectory.
 * Reads latest VO2max, most-recent long-run decoupling/EF, current weight;
 * derives a HM race prediction from VDOT. Returns the row, or null if no metric. DB.
 */
export async function updateFitnessTrajectory(sql: QueryFn, targetDate: string): Promise<FitnessTrajectory | null> {
  let vo2max: number | null = null;
  let ef: number | null = null;
  let decouplingPct: number | null = null;
  let weightKg: number | null = null;

  const vo2Rows = await sql`
    SELECT raw_json FROM garmin_raw_data
    WHERE endpoint_name = 'max_metrics' AND date <= ${targetDate}
    ORDER BY date DESC LIMIT 1`;
  if (vo2Rows.length) {
    const raw = typeof vo2Rows[0].raw_json === "string" ? JSON.parse(vo2Rows[0].raw_json) : vo2Rows[0].raw_json;
    vo2max = extractVo2max(raw);
  }

  // Most recent qualifying run (>40min, running), by start date, then its splits.
  const splitsRows = await sql`
    SELECT raw_json FROM garmin_activity_raw
    WHERE endpoint_name = 'splits' AND activity_id IN (
      SELECT activity_id FROM garmin_activity_raw
      WHERE endpoint_name = 'summary'
        AND (raw_json->>'duration')::float > 2400
        AND raw_json->'activityType'->>'typeKey' = 'running'
        AND (raw_json->>'startTimeLocal')::date <= ${targetDate}
      ORDER BY (raw_json->>'startTimeLocal')::date DESC LIMIT 1)`;
  if (splitsRows.length) {
    const splitsRaw = typeof splitsRows[0].raw_json === "string" ? JSON.parse(splitsRows[0].raw_json) : splitsRows[0].raw_json;
    const halves = splitIntoHalves(splitsRaw);
    if (halves) {
      ef = computeEfficiencyFactor(halves[0].pace_sec_km, halves[0].avg_hr);
      decouplingPct = computeDecoupling(halves[0], halves[1]);
    }
  }

  // Fallback: EF from the summary directly if no splits.
  if (ef === null) {
    const sumRows = await sql`
      SELECT raw_json FROM garmin_activity_raw
      WHERE endpoint_name = 'summary'
        AND (raw_json->>'duration')::float > 2400
        AND raw_json->'activityType'->>'typeKey' = 'running'
        AND (raw_json->>'startTimeLocal')::date <= ${targetDate}
      ORDER BY (raw_json->>'startTimeLocal')::date DESC LIMIT 1`;
    if (sumRows.length) {
      const s = typeof sumRows[0].raw_json === "string" ? JSON.parse(sumRows[0].raw_json) : sumRows[0].raw_json;
      const distanceM = s.distance, durationS = s.duration, avgHr = s.averageHR;
      if (distanceM && durationS && avgHr && distanceM > 0) {
        ef = computeEfficiencyFactor(durationS / (distanceM / 1000.0), avgHr);
      }
    }
  }

  const wRows = await sql`
    SELECT weight_grams / 1000.0 AS kg FROM weight_log
    WHERE date <= ${targetDate} AND weight_grams IS NOT NULL AND weight_grams > 0
    ORDER BY date DESC LIMIT 1`;
  if (wRows.length) weightKg = Number(wRows[0].kg);

  if (vo2max === null && ef === null && decouplingPct === null) return null;

  let racePredictionSeconds: number | null = null;
  if (vo2max !== null && vo2max > 0) racePredictionSeconds = Math.round(timeFromVdot(vo2max, HM_M));

  const row: FitnessTrajectory = {
    date: targetDate,
    vo2max,
    efficiency_factor: ef !== null ? r(ef, 10) : null,
    decoupling_pct: decouplingPct !== null ? r(decouplingPct, 2) : null,
    weight_kg: weightKg !== null ? r(weightKg, 1) : null,
    race_prediction_seconds: racePredictionSeconds,
  };

  await sql`
    INSERT INTO fitness_trajectory
      (date, vo2max, efficiency_factor, decoupling_pct, weight_kg, race_prediction_seconds, computed_at)
    VALUES (${row.date}, ${row.vo2max}, ${row.efficiency_factor}, ${row.decoupling_pct},
            ${row.weight_kg}, ${row.race_prediction_seconds}, NOW())
    ON CONFLICT (date) DO UPDATE SET
      vo2max = EXCLUDED.vo2max, efficiency_factor = EXCLUDED.efficiency_factor,
      decoupling_pct = EXCLUDED.decoupling_pct, weight_kg = EXCLUDED.weight_kg,
      race_prediction_seconds = EXCLUDED.race_prediction_seconds, computed_at = NOW()`;
  return row;
}
