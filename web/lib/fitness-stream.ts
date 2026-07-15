/**
 * Fitness stream — TS port of sync/src/training_engine/fitness_stream.py.
 * VO2max trend, pace:HR decoupling, efficiency factor, and a VDOT-derived
 * half-marathon race prediction → fitness_trajectory (a table the dashboard
 * graphs). Pure metric helpers + one DB step. Stage: training engine (#187).
 *
 * EF = speed / HR; decoupling = (EF_first − EF_second) / EF_first × 100.
 */
import type { QueryFn } from "./db";
import { timeFromVdot } from "./vdot";

const HM_DISTANCE_M = 21097.5;
const r = (x: number, n: number) => Number(x.toFixed(n));

/** EF = (1/pace) / HR. Higher = more efficient. 0 when inputs non-positive. */
export function computeEfficiencyFactor(paceSecPerKm: number, avgHr: number): number {
  if (paceSecPerKm <= 0 || avgHr <= 0) return 0.0;
  const speed = 1.0 / paceSecPerKm; // km/sec
  return speed / avgHr;
}

export interface Half { pace_sec_km: number; avg_hr: number; }

/** Pace:HR decoupling % between two halves (positive = cardiac drift). */
export function computeDecoupling(firstHalf: Half, secondHalf: Half): number {
  const ef1 = computeEfficiencyFactor(firstHalf.pace_sec_km, firstHalf.avg_hr);
  const ef2 = computeEfficiencyFactor(secondHalf.pace_sec_km, secondHalf.avg_hr);
  if (ef1 === 0) return 0.0;
  return ((ef1 - ef2) / ef1) * 100;
}

/** Extract VO2max from Garmin max_metrics raw (list or dict; generic or top-level). */
export function extractVo2max(raw: unknown): number | null {
  const fromItem = (item: any): number | null => {
    if (!item || typeof item !== "object") return null;
    const generic = item.generic;
    if (generic && typeof generic === "object" && generic.vo2MaxPreciseValue != null) {
      return Number(generic.vo2MaxPreciseValue);
    }
    if (item.vo2MaxPreciseValue != null) return Number(item.vo2MaxPreciseValue);
    return null;
  };
  if (Array.isArray(raw)) {
    for (const item of raw) { const v = fromItem(item); if (v !== null) return v; }
    return null;
  }
  if (raw && typeof raw === "object") return fromItem(raw);
  return null;
}

/** Aggregate laps into a single {pace_sec_km, avg_hr}, or null if insufficient. */
export function aggregateLaps(laps: any[]): Half | null {
  let totalDistanceM = 0.0, totalDurationS = 0.0, hrWeightedSum = 0.0;
  for (const lap of laps) {
    const distance = lap.distance || 0;
    const duration = lap.duration || lap.elapsedDuration || 0;
    const avgHr = lap.averageHR || lap.averageHeartRate || 0;
    if (distance > 0 && duration > 0 && avgHr > 0) {
      totalDistanceM += distance;
      totalDurationS += duration;
      hrWeightedSum += avgHr * duration;
    }
  }
  if (totalDistanceM <= 0 || totalDurationS <= 0 || hrWeightedSum <= 0) return null;
  return {
    pace_sec_km: totalDurationS / (totalDistanceM / 1000.0),
    avg_hr: hrWeightedSum / totalDurationS,
  };
}

/** Split raw Garmin splits into first/second-half aggregates, or null. */
export function splitIntoHalves(splitsRaw: any): [Half, Half] | null {
  let laps: any[] = [];
  if (splitsRaw && !Array.isArray(splitsRaw) && typeof splitsRaw === "object") {
    laps = splitsRaw.lapDTOs || splitsRaw.splitSummaries || [];
  } else if (Array.isArray(splitsRaw)) {
    laps = splitsRaw;
  }
  if (laps.length < 2) return null;
  const mid = Math.floor(laps.length / 2);
  const firstHalf = aggregateLaps(laps.slice(0, mid));
  const secondHalf = aggregateLaps(laps.slice(mid));
  if (firstHalf === null || secondHalf === null) return null;
  return [firstHalf, secondHalf];
}

export interface FitnessTrajectory {
  date: string;
  vo2max: number | null;
  efficiency_factor: number | null;
  decoupling_pct: number | null;
  weight_kg: number | null;
  race_prediction_seconds: number | null;
}

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
  if (vo2max !== null && vo2max > 0) racePredictionSeconds = Math.round(timeFromVdot(vo2max, HM_DISTANCE_M));

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
