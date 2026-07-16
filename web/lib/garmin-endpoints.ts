/**
 * Garmin connectapi endpoint table — the exact URL + params each garminconnect
 * method builds, captured as golden fixtures from the Python library and verified
 * by garmin-endpoints.test.ts. Drives the TS Garmin ingestion cron (#183): each
 * request goes through garmin-auth's GarminClient.connectapi(url, params).
 *
 * Placeholders: {display} = user display name, {cdate} = YYYY-MM-DD, {aid} = activity id.
 */

export type ParamValue = string | number | boolean;
export interface GarminRequest {
  url: string;
  params: Record<string, ParamValue> | null;
}
type Spec = { url: string; params?: Record<string, ParamValue> | null };

/** Daily endpoints (single date). Mirrors garmin_sync.DAILY_ENDPOINTS. */
export const DAILY_ENDPOINTS: Record<string, Spec> = {
  user_summary: { url: "/usersummary-service/usersummary/daily/{display}", params: { calendarDate: "{cdate}" } },
  heart_rates: { url: "/wellness-service/wellness/dailyHeartRate/{display}", params: { date: "{cdate}" } },
  sleep_data: { url: "/wellness-service/wellness/dailySleepData/{display}", params: { date: "{cdate}", nonSleepBufferMinutes: 60 } },
  stress_data: { url: "/wellness-service/wellness/dailyStress/{cdate}" },
  hrv_data: { url: "/hrv-service/hrv/{cdate}" },
  spo2_data: { url: "/wellness-service/wellness/daily/spo2/{cdate}" },
  respiration_data: { url: "/wellness-service/wellness/daily/respiration/{cdate}" },
  steps_data: { url: "/wellness-service/wellness/dailySummaryChart/{display}", params: { date: "{cdate}" } },
  floors: { url: "/wellness-service/wellness/floorsChartData/daily/{cdate}" },
  hydration_data: { url: "/usersummary-service/usersummary/hydration/daily/{cdate}" },
  blood_pressure: { url: "/bloodpressure-service/bloodpressure/range/{cdate}/{cdate}", params: { includeAll: true } },
  training_readiness: { url: "/metrics-service/metrics/trainingreadiness/{cdate}" },
  training_status: { url: "/metrics-service/metrics/trainingstatus/aggregated/{cdate}" },
  max_metrics: { url: "/metrics-service/metrics/maxmet/daily/{cdate}/{cdate}" },
  race_predictions: { url: "/metrics-service/metrics/racepredictions/latest/{display}" },
  endurance_score: { url: "/metrics-service/metrics/endurancescore", params: { calendarDate: "{cdate}" } },
  hill_score: { url: "/metrics-service/metrics/hillscore", params: { calendarDate: "{cdate}" } },
  fitnessage_data: { url: "/fitnessage-service/fitnessage/{cdate}" },
  intensity_minutes_data: { url: "/wellness-service/wellness/daily/im/{cdate}" },
  daily_weigh_ins: { url: "/weight-service/weight/dayview/{cdate}", params: { includeAll: true } },
  rhr_day: { url: "/userstats-service/wellness/daily/{display}", params: { fromDate: "{cdate}", untilDate: "{cdate}", metricId: 60 } },
  body_battery_events: { url: "/wellness-service/wellness/bodyBattery/events/{cdate}" },
};

/** Range endpoints — sync_day calls these with a single-day range (start=end=cdate). */
export const RANGE_ENDPOINTS: Record<string, Spec> = {
  body_battery: { url: "/wellness-service/wellness/bodyBattery/reports/daily", params: { startDate: "{cdate}", endDate: "{cdate}" } },
  weigh_ins: { url: "/weight-service/weight/range/{cdate}/{cdate}", params: { includeAll: true } },
  body_composition: { url: "/weight-service/weight/dateRange", params: { startDate: "{cdate}", endDate: "{cdate}" } },
};

/** Per-activity detail endpoints. Mirrors garmin_sync.ACTIVITY_DETAIL_ENDPOINTS. */
export const ACTIVITY_DETAIL_ENDPOINTS: Record<string, Spec> = {
  details: { url: "/activity-service/activity/{aid}/details", params: { maxChartSize: "2000", maxPolylineSize: "4000" } },
  exercise_sets: { url: "/activity-service/activity/{aid}/exerciseSets" },
  splits: { url: "/activity-service/activity/{aid}/splits" },
  typed_splits: { url: "/activity-service/activity/{aid}/typedsplits" },
  split_summaries: { url: "/activity-service/activity/{aid}/split_summaries" },
  hr_zones: { url: "/activity-service/activity/{aid}/hrTimeInZones" },
  weather: { url: "/activity-service/activity/{aid}/weather" },
  gear: { url: "/gear-service/gear/filterGear", params: { activityId: "{aid}" } },
};

/** Activity discovery for a date. Mirrors get_activities_by_date. */
export const DISCOVERY_ENDPOINTS: Record<string, Spec> = {
  activities_list: { url: "/activitylist-service/activities/search/activities", params: { startDate: "{cdate}", start: "0", limit: "20", endDate: "{cdate}" } },
};

export interface RequestCtx {
  display?: string;
  cdate?: string;
  aid?: string | number;
}

function sub(s: string, ctx: RequestCtx): string {
  return s
    .replace(/\{display\}/g, String(ctx.display ?? ""))
    .replace(/\{cdate\}/g, String(ctx.cdate ?? ""))
    .replace(/\{aid\}/g, String(ctx.aid ?? ""));
}

/** Build the concrete {url, params} for an endpoint spec with the given context. */
export function buildRequest(spec: Spec, ctx: RequestCtx): GarminRequest {
  const url = sub(spec.url, ctx);
  if (!spec.params) return { url, params: null };
  const params: Record<string, ParamValue> = {};
  for (const [k, v] of Object.entries(spec.params)) params[k] = typeof v === "string" ? sub(v, ctx) : v;
  return { url, params };
}

/** All endpoint groups keyed by name, for iteration and lookup. */
export const ALL_ENDPOINTS = {
  daily: DAILY_ENDPOINTS,
  range: RANGE_ENDPOINTS,
  detail: ACTIVITY_DETAIL_ENDPOINTS,
  discovery: DISCOVERY_ENDPOINTS,
} as const;
