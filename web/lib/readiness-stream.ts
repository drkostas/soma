/**
 * Readiness stream — TS port of sync/src/training_engine/readiness_stream.py.
 * Daily readiness (traffic light) from biometric z-scores vs a 28-day baseline:
 * HRV, sleep time, RHR (inverted), morning body battery. Equal-weight composite
 * (Dawes 1979) + hard overrides. Writes daily_readiness (dashboard reads it).
 * Pure scoring + one DB step. Stage: training engine (#187). DB-only.
 */
import type { QueryFn } from "./db";

const r = (x: number, n: number) => Number(x.toFixed(n));

/** Population z-score of value vs baseline; 0.0 if <7 samples or zero std. */
export function zScore(value: number, baseline: number[]): number {
  if (baseline.length < 7) return 0.0;
  const n = baseline.length;
  const mean = baseline.reduce((a, b) => a + b, 0) / n;
  const variance = baseline.reduce((a, x) => a + (x - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  if (std === 0.0) return 0.0;
  return (value - mean) / std;
}

export interface ReadinessSignals {
  hrv_z: number | null;
  sleep_z: number | null;
  rhr_z: number | null;
  bb_z: number | null;
  sleep_hours: number;
  body_battery_morning?: number | null;
}

export interface Readiness {
  hrv_z_score: number | null;
  sleep_z_score: number | null;
  rhr_z_score: number | null;
  body_battery_z_score: number | null;
  composite_score: number;
  traffic_light: "green" | "yellow" | "red";
  flags: string[];
}

/** Traffic-light readiness from signal z-scores + hard overrides. */
export function computeReadiness(signals: ReadinessSignals): Readiness {
  const { hrv_z, sleep_z, rhr_z, bb_z, sleep_hours } = signals;
  const bodyBatteryMorning = signals.body_battery_morning ?? null;

  // Equal-weight composite over non-null z-scores.
  const zValues = [hrv_z, sleep_z, rhr_z, bb_z].filter((z): z is number => z !== null && z !== undefined);
  const composite = zValues.length ? zValues.reduce((a, b) => a + b, 0) / zValues.length : 0.0;

  const flags: string[] = [];
  let trafficLight: "green" | "yellow" | "red" = "green";

  if (sleep_hours < 5.0) { flags.push("sleep_under_5h"); trafficLight = "red"; }
  if (bodyBatteryMorning !== null && bodyBatteryMorning < 25) { flags.push("body_battery_critical"); trafficLight = "red"; }
  if (hrv_z !== null && hrv_z !== undefined && hrv_z < -0.5) flags.push("hrv_below_swc");

  const flaggedCount = zValues.filter((z) => z < -1.0).length;
  if (flaggedCount >= 3) { flags.push("3_of_4_flagged"); trafficLight = "red"; }
  else if (flaggedCount >= 2 && trafficLight !== "red") { flags.push("2_of_4_flagged"); trafficLight = "yellow"; }

  return {
    hrv_z_score: hrv_z,
    sleep_z_score: sleep_z,
    rhr_z_score: rhr_z,
    body_battery_z_score: bb_z,
    composite_score: r(composite, 4),
    traffic_light: trafficLight,
    flags,
  };
}

/**
 * Compute + upsert daily_readiness for a date, from a 35-day daily_health_summary
 * window. Port of compute_daily_readiness. RHR z is negated (high RHR = low
 * readiness). Returns the readiness dict. DB.
 */
export async function computeDailyReadiness(sql: QueryFn, targetDate: string): Promise<Readiness> {
  const startDate = new Date(Date.parse(targetDate + "T00:00:00Z") - 34 * 86_400_000).toISOString().slice(0, 10);

  const rows = await sql`
    SELECT date::text AS date, avg_overnight_hrv, sleep_time_seconds,
           resting_heart_rate, body_battery_at_wake
    FROM daily_health_summary
    WHERE date BETWEEN ${startDate} AND ${targetDate}
    ORDER BY date`;

  const noData = (flag: string): Readiness => ({
    hrv_z_score: null, sleep_z_score: null, rhr_z_score: null, body_battery_z_score: null,
    composite_score: 0.0, traffic_light: "green", flags: [flag],
  });
  if (!rows.length) return noData("no_data");

  const targetRow = rows.find((r2) => r2.date === targetDate);
  const baselineRows = rows.filter((r2) => r2.date !== targetDate);
  if (!targetRow) return noData("no_target_data");

  const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
  const todayHrv = num(targetRow.avg_overnight_hrv);
  const todaySleep = num(targetRow.sleep_time_seconds);
  const todayRhr = num(targetRow.resting_heart_rate);
  const todayBb = num(targetRow.body_battery_at_wake);

  const baseline = (key: string): number[] =>
    baselineRows.map((r2) => num(r2[key])).filter((x): x is number => x !== null);

  const hrvZ = todayHrv !== null ? zScore(todayHrv, baseline("avg_overnight_hrv")) : null;
  const sleepZ = todaySleep !== null ? zScore(todaySleep, baseline("sleep_time_seconds")) : null;
  const rhrRaw = todayRhr !== null ? zScore(todayRhr, baseline("resting_heart_rate")) : null;
  const rhrZ = rhrRaw !== null ? -rhrRaw : null; // inverted
  const bbZ = todayBb !== null ? zScore(todayBb, baseline("body_battery_at_wake")) : null;

  const sleepHours = todaySleep !== null ? todaySleep / 3600.0 : 8.0;

  const result = computeReadiness({
    hrv_z: hrvZ, sleep_z: sleepZ, rhr_z: rhrZ, bb_z: bbZ,
    sleep_hours: sleepHours, body_battery_morning: todayBb,
  });

  await sql`
    INSERT INTO daily_readiness
      (date, hrv_z_score, sleep_z_score, rhr_z_score, body_battery_z_score,
       composite_score, traffic_light, flags, weight_method, computed_at)
    VALUES (${targetDate}, ${result.hrv_z_score}, ${result.sleep_z_score}, ${result.rhr_z_score},
            ${result.body_battery_z_score}, ${result.composite_score}, ${result.traffic_light},
            ${JSON.stringify(result.flags)}, 'equal', NOW())
    ON CONFLICT (date) DO UPDATE SET
      hrv_z_score = EXCLUDED.hrv_z_score, sleep_z_score = EXCLUDED.sleep_z_score,
      rhr_z_score = EXCLUDED.rhr_z_score, body_battery_z_score = EXCLUDED.body_battery_z_score,
      composite_score = EXCLUDED.composite_score, traffic_light = EXCLUDED.traffic_light,
      flags = EXCLUDED.flags, weight_method = EXCLUDED.weight_method, computed_at = NOW()`;
  return result;
}
