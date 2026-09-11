/** Readiness stream, DB half: daily_readiness from the recovery rows. zScore/computeReadiness live in banister. */
import type { QueryFn } from "./db";
import type { Readiness } from "banister";
import { zScore, computeReadiness } from "banister";
export { zScore, computeReadiness } from "banister";
export type { ReadinessSignals, TrafficLight, Readiness } from "banister";

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
    composite_score: null, traffic_light: "unknown", flags: [flag],
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

  // No default night: a missing sleep_time_seconds stays null and yields "unknown"
  // (the old 8.0 h stand-in produced a green light from resting HR alone; #647).
  const sleepHours = todaySleep !== null ? todaySleep / 3600.0 : null;

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
