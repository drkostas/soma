/**
 * Pure Garmin raw-JSON → structured-row parsers. TS port of sync/src/parsers.py
 * (the parse_* functions). No I/O — the DB upserts live in the ingestion cron.
 *
 * Stage 1 of the soma-core migration (#183): these produce the exact field maps
 * the Python parsers did, verified against golden fixtures captured from Python.
 */

/** ms Unix timestamp → Date (UTC instant), or null. Mirrors _ms_to_datetime. */
export function msToDatetime(ms: number | null | undefined): Date | null {
  if (ms === null || ms === undefined) return null;
  if (typeof ms === "number") return new Date(ms);
  return ms;
}

export interface DailyHealth {
  date: string;
  total_steps: number | null;
  total_distance_meters: number | null;
  floors_climbed: number | null;
  active_time_seconds: number | null;
  sedentary_time_seconds: number | null;
  moderate_intensity_minutes: number | null;
  vigorous_intensity_minutes: number | null;
  total_kilocalories: number | null;
  active_kilocalories: number | null;
  bmr_kilocalories: number | null;
  resting_heart_rate: number | null;
  min_heart_rate: number | null;
  max_heart_rate: number | null;
  avg_stress_level: number | null;
  max_stress_level: number | null;
  body_battery_charged: number | null;
  body_battery_drained: number | null;
  sleep_time_seconds: number | null;
  body_battery_at_wake: number | null;
  rhr_7day_avg: number | null;
  // merged-in fields (hrv / readiness / race prediction)
  hrv_weekly_avg?: number | null;
  hrv_last_night_avg?: number | null;
  hrv_status?: string | null;
  avg_overnight_hrv?: number | null;
  hrv_baseline?: number | null;
  avg_sleep_stress?: number | null;
  training_readiness_score?: number | null;
  training_readiness_level?: string | null;
  garmin_hm_prediction_seconds?: number;
}

const g = <T>(o: Record<string, any>, k: string): T | null => (o[k] === undefined ? null : o[k]);

/** Extract structured fields from user_summary raw JSON. */
export function parseDailyHealth(syncDate: string, raw: Record<string, any>): DailyHealth {
  return {
    date: syncDate,
    total_steps: g(raw, "totalSteps"),
    total_distance_meters: g(raw, "totalDistanceMeters"),
    floors_climbed: g(raw, "floorsClimbed"),
    active_time_seconds: g(raw, "activeTimeInSeconds"),
    sedentary_time_seconds: g(raw, "sedentaryTimeInSeconds"),
    moderate_intensity_minutes: g(raw, "moderateIntensityMinutes"),
    vigorous_intensity_minutes: g(raw, "vigorousIntensityMinutes"),
    total_kilocalories: g(raw, "totalKilocalories"),
    active_kilocalories: g(raw, "activeKilocalories"),
    bmr_kilocalories: g(raw, "bmrKilocalories"),
    resting_heart_rate: g(raw, "restingHeartRate"),
    min_heart_rate: g(raw, "minHeartRate"),
    max_heart_rate: g(raw, "maxHeartRate"),
    avg_stress_level: g(raw, "averageStressLevel"),
    max_stress_level: g(raw, "maxStressLevel"),
    body_battery_charged: g(raw, "bodyBatteryChargedValue"),
    body_battery_drained: g(raw, "bodyBatteryDrainedValue"),
    sleep_time_seconds: g(raw, "sleepingTimeInSeconds"),
    body_battery_at_wake: g(raw, "bodyBatteryAtWakeTime"),
    rhr_7day_avg: g(raw, "lastSevenDaysAvgRestingHeartRate"),
  };
}

export interface WeightEntry {
  date: string | null;
  weight_grams: number | null;
  bmi: number | null;
  body_fat_pct: number | null;
  body_water_pct: number | null;
  bone_mass_grams: number | null;
  muscle_mass_grams: number | null;
  source_type: string | null;
}

/** Extract weight entries from weigh_ins raw JSON. */
export function parseWeightEntries(raw: Record<string, any>): WeightEntry[] {
  const list: any[] = raw.dateWeightList ?? [];
  return list.map((item) => ({
    date: g(item, "calendarDate"),
    weight_grams: g(item, "weight"),
    bmi: g(item, "bmi"),
    body_fat_pct: g(item, "bodyFat"),
    body_water_pct: g(item, "bodyWater"),
    bone_mass_grams: g(item, "boneMass"),
    muscle_mass_grams: g(item, "muscleMass"),
    source_type: g(item, "sourceType"),
  }));
}

export interface SleepDetail {
  total_sleep_seconds: number | null;
  deep_sleep_seconds: number | null;
  light_sleep_seconds: number | null;
  rem_sleep_seconds: number | null;
  awake_seconds: number | null;
  sleep_score: number | null;
  sleep_start: Date | null;
  sleep_end: Date | null;
  avg_sleep_stress: number | null;
}

/** Extract sleep fields from sleep_data raw JSON, or null when absent. */
export function parseSleep(raw: Record<string, any>): SleepDetail | null {
  const dto = raw.dailySleepDTO;
  if (!dto) return null;
  const overall = ((dto.sleepScores ?? {}).overall ?? {}).value;
  return {
    total_sleep_seconds: g(dto, "sleepTimeSeconds"),
    deep_sleep_seconds: g(dto, "deepSleepSeconds"),
    light_sleep_seconds: g(dto, "lightSleepSeconds"),
    rem_sleep_seconds: g(dto, "remSleepSeconds"),
    awake_seconds: g(dto, "awakeSleepSeconds"),
    sleep_score: overall === undefined ? null : overall,
    sleep_start: msToDatetime(dto.sleepStartTimestampLocal),
    sleep_end: msToDatetime(dto.sleepEndTimestampLocal),
    avg_sleep_stress: g(dto, "avgSleepStress"),
  };
}

export interface Hrv {
  hrv_weekly_avg: number | null;
  hrv_last_night_avg: number | null;
  hrv_status: string | null;
  avg_overnight_hrv: number | null;
  hrv_baseline: number | null;
}

/** Extract HRV fields from hrv_data raw JSON (nested under hrvSummary). */
export function parseHrv(raw: Record<string, any>): Hrv {
  const summary = raw.hrvSummary ?? raw;
  const baseline = summary.baseline ?? {};
  return {
    hrv_weekly_avg: g(summary, "weeklyAvg"),
    hrv_last_night_avg: g(summary, "lastNightAvg"),
    hrv_status: g(summary, "status"),
    avg_overnight_hrv: g(summary, "lastNightAvg"),
    hrv_baseline: g(baseline, "balancedLow"),
  };
}

export interface TrainingReadiness {
  training_readiness_score: number | null;
  training_readiness_level: string | null;
}

/**
 * Extract training readiness. The raw data is a list of snapshots; prefer the
 * latest validSleep=true entry (post-sleep), else the first entry.
 */
export function parseTrainingReadiness(raw: any): TrainingReadiness {
  if (!raw || !Array.isArray(raw)) return { training_readiness_score: null, training_readiness_level: null };
  let best: any = null;
  for (const entry of raw) if (entry.validSleep) best = entry;
  if (best === null && raw.length) best = raw[0];
  return {
    training_readiness_score: best ? g(best, "score") : null,
    training_readiness_level: best ? g(best, "level") : null,
  };
}
