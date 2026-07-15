/**
 * Parse a day's raw Garmin JSON into the structured tables — TS port of
 * sync/src/parsers.py::process_day. Reads garmin_raw_data for a date and upserts
 * daily_health_summary / sleep_detail / weight_log (and syncs the Garmin step
 * goal into nutrition_profile). Wired into the Garmin ingestion cron so the TS
 * path produces the same structured rows the Python parse did. Stage 1 completion (#187).
 */
import type { QueryFn } from "./db";
import {
  parseDailyHealth, parseWeightEntries, parseSleep, parseHrv, parseTrainingReadiness,
  type DailyHealth,
} from "./garmin-health-parsers";

/** Upsert the merged daily-health row. Base fields overwrite; merged fields
 * (hrv/readiness/race) use COALESCE so a later run without them doesn't clobber. */
async function upsertDailyHealth(sql: QueryFn, d: DailyHealth): Promise<void> {
  await sql`
    INSERT INTO daily_health_summary
      (date, total_steps, total_distance_meters, floors_climbed, active_time_seconds,
       sedentary_time_seconds, moderate_intensity_minutes, vigorous_intensity_minutes,
       total_kilocalories, active_kilocalories, bmr_kilocalories, resting_heart_rate,
       min_heart_rate, max_heart_rate, avg_stress_level, max_stress_level,
       body_battery_charged, body_battery_drained, sleep_time_seconds, body_battery_at_wake,
       rhr_7day_avg, hrv_weekly_avg, hrv_last_night_avg, hrv_status, avg_overnight_hrv,
       hrv_baseline, avg_sleep_stress, training_readiness_score, training_readiness_level,
       garmin_hm_prediction_seconds)
    VALUES
      (${d.date}, ${d.total_steps}, ${d.total_distance_meters}, ${d.floors_climbed}, ${d.active_time_seconds},
       ${d.sedentary_time_seconds}, ${d.moderate_intensity_minutes}, ${d.vigorous_intensity_minutes},
       ${d.total_kilocalories}, ${d.active_kilocalories}, ${d.bmr_kilocalories}, ${d.resting_heart_rate},
       ${d.min_heart_rate}, ${d.max_heart_rate}, ${d.avg_stress_level}, ${d.max_stress_level},
       ${d.body_battery_charged}, ${d.body_battery_drained}, ${d.sleep_time_seconds}, ${d.body_battery_at_wake},
       ${d.rhr_7day_avg}, ${d.hrv_weekly_avg ?? null}, ${d.hrv_last_night_avg ?? null}, ${d.hrv_status ?? null}, ${d.avg_overnight_hrv ?? null},
       ${d.hrv_baseline ?? null}, ${d.avg_sleep_stress ?? null}, ${d.training_readiness_score ?? null}, ${d.training_readiness_level ?? null},
       ${d.garmin_hm_prediction_seconds ?? null})
    ON CONFLICT (date) DO UPDATE SET
      total_steps = EXCLUDED.total_steps, total_distance_meters = EXCLUDED.total_distance_meters,
      floors_climbed = EXCLUDED.floors_climbed, active_time_seconds = EXCLUDED.active_time_seconds,
      sedentary_time_seconds = EXCLUDED.sedentary_time_seconds, moderate_intensity_minutes = EXCLUDED.moderate_intensity_minutes,
      vigorous_intensity_minutes = EXCLUDED.vigorous_intensity_minutes, total_kilocalories = EXCLUDED.total_kilocalories,
      active_kilocalories = EXCLUDED.active_kilocalories, bmr_kilocalories = EXCLUDED.bmr_kilocalories,
      resting_heart_rate = EXCLUDED.resting_heart_rate, min_heart_rate = EXCLUDED.min_heart_rate,
      max_heart_rate = EXCLUDED.max_heart_rate, avg_stress_level = EXCLUDED.avg_stress_level,
      max_stress_level = EXCLUDED.max_stress_level, body_battery_charged = EXCLUDED.body_battery_charged,
      body_battery_drained = EXCLUDED.body_battery_drained, sleep_time_seconds = EXCLUDED.sleep_time_seconds,
      body_battery_at_wake = EXCLUDED.body_battery_at_wake, rhr_7day_avg = EXCLUDED.rhr_7day_avg,
      hrv_weekly_avg = COALESCE(EXCLUDED.hrv_weekly_avg, daily_health_summary.hrv_weekly_avg),
      hrv_last_night_avg = COALESCE(EXCLUDED.hrv_last_night_avg, daily_health_summary.hrv_last_night_avg),
      hrv_status = COALESCE(EXCLUDED.hrv_status, daily_health_summary.hrv_status),
      avg_overnight_hrv = COALESCE(EXCLUDED.avg_overnight_hrv, daily_health_summary.avg_overnight_hrv),
      hrv_baseline = COALESCE(EXCLUDED.hrv_baseline, daily_health_summary.hrv_baseline),
      avg_sleep_stress = COALESCE(EXCLUDED.avg_sleep_stress, daily_health_summary.avg_sleep_stress),
      training_readiness_score = COALESCE(EXCLUDED.training_readiness_score, daily_health_summary.training_readiness_score),
      training_readiness_level = COALESCE(EXCLUDED.training_readiness_level, daily_health_summary.training_readiness_level),
      garmin_hm_prediction_seconds = COALESCE(EXCLUDED.garmin_hm_prediction_seconds, daily_health_summary.garmin_hm_prediction_seconds),
      updated_at = NOW()`;
}

/** Parse the raw data for one date and populate the structured tables. */
export async function processDay(sql: QueryFn, date: string): Promise<{ health: boolean; weights: number; sleep: boolean }> {
  const rows = await sql`SELECT endpoint_name, raw_json FROM garmin_raw_data WHERE date = ${date}`;
  const raw: Record<string, any> = {};
  for (const r of rows) raw[r.endpoint_name] = typeof r.raw_json === "string" ? JSON.parse(r.raw_json) : r.raw_json;

  let health = false, weights = 0, sleep = false;

  if (raw.user_summary) {
    const parsed = parseDailyHealth(date, raw.user_summary);
    if (raw.hrv_data) Object.assign(parsed, parseHrv(raw.hrv_data));
    if (raw.sleep_data) {
      const s = parseSleep(raw.sleep_data);
      if (s) {
        if (!parsed.sleep_time_seconds && s.total_sleep_seconds) parsed.sleep_time_seconds = s.total_sleep_seconds;
        if (s.avg_sleep_stress != null) parsed.avg_sleep_stress = s.avg_sleep_stress;
      }
    }
    if (raw.training_readiness) Object.assign(parsed, parseTrainingReadiness(raw.training_readiness));
    const rp = raw.race_predictions;
    if (rp && typeof rp === "object" && rp.timeHalfMarathon) parsed.garmin_hm_prediction_seconds = Math.trunc(rp.timeHalfMarathon);

    await upsertDailyHealth(sql, parsed);
    health = true;

    const goal = raw.user_summary.dailyStepGoal;
    if (goal && Number(goal) > 0) {
      await sql`UPDATE nutrition_profile SET step_goal = ${Math.trunc(Number(goal))}
                WHERE id = 1 AND (step_goal IS NULL OR step_goal != ${Math.trunc(Number(goal))})`;
    }
  }

  for (const ep of ["daily_weigh_ins", "weigh_ins"]) {
    if (raw[ep]) {
      for (const w of parseWeightEntries(raw[ep])) {
        if (w.weight_grams) {
          await sql`
            INSERT INTO weight_log (date, weight_grams, bmi, body_fat_pct, body_water_pct, bone_mass_grams, muscle_mass_grams, source_type)
            VALUES (${w.date}, ${w.weight_grams}, ${w.bmi}, ${w.body_fat_pct}, ${w.body_water_pct}, ${w.bone_mass_grams}, ${w.muscle_mass_grams}, ${w.source_type})
            ON CONFLICT (date, weight_grams) DO NOTHING`;
          weights += 1;
        }
      }
    }
  }

  if (raw.sleep_data) {
    const s = parseSleep(raw.sleep_data);
    if (s) {
      await sql`
        INSERT INTO sleep_detail (date, sleep_start, sleep_end, total_sleep_seconds, deep_sleep_seconds,
          light_sleep_seconds, rem_sleep_seconds, awake_seconds, sleep_score)
        VALUES (${date}, ${s.sleep_start}, ${s.sleep_end}, ${s.total_sleep_seconds}, ${s.deep_sleep_seconds},
          ${s.light_sleep_seconds}, ${s.rem_sleep_seconds}, ${s.awake_seconds}, ${s.sleep_score})
        ON CONFLICT (date) DO UPDATE SET
          sleep_start = EXCLUDED.sleep_start, sleep_end = EXCLUDED.sleep_end,
          total_sleep_seconds = EXCLUDED.total_sleep_seconds, deep_sleep_seconds = EXCLUDED.deep_sleep_seconds,
          light_sleep_seconds = EXCLUDED.light_sleep_seconds, rem_sleep_seconds = EXCLUDED.rem_sleep_seconds,
          awake_seconds = EXCLUDED.awake_seconds, sleep_score = EXCLUDED.sleep_score, synced_at = NOW()`;
      sleep = true;
    }
  }

  return { health, weights, sleep };
}
