/**
 * Banister impulse-response fit — TS port of the DB glue in
 * sync/src/training_engine/banister.py. The model itself (predict + the
 * differential-evolution fit that matches scipy) lives in the `banister` npm
 * package (drkostas/banister, verified against scipy in Phase-0); this module
 * is the soma-specific DB layer: anchor detection from Garmin runs, daily-load
 * loading (same cross-modal signal as the PMC), and fit_from_db which stores
 * banister_params. Stage: training engine (#187). DB-only.
 *
 * The DE fit is stochastic, so fitted params / current_vdot are close to but
 * not bit-identical to the Python (scipy) fit — this is a model fit, not a
 * deterministic transform.
 */
import { banisterPredict, fitBanister, DEFAULT_PARAMS, type BanisterParams, type DailyLoad, type Anchor } from "banister";
import type { QueryFn } from "./db";
import { vdotFromRace } from "./vdot";
import { crossModalScale } from "./pmc-stream";

export type { BanisterParams };
export { banisterPredict, DEFAULT_PARAMS };

/** Today (YYYY-MM-DD) in America/New_York — mirrors config.today_nyc. */
function todayNyc(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000);
}

export interface RunInput { date: string; avg_hr: number; distance_m: number; duration_s: number; activity_id?: number; }
export interface AnchorRun extends RunInput { vdot: number; }

/**
 * Detect maximal-effort anchor runs (avg_hr ≥ pct·HRmax AND distance ≥ min),
 * compute VDOT for each, sort by date. Port of detect_anchor_runs.
 */
export function detectAnchorRuns(
  runs: RunInput[], estimatedHrmax: number, hrThresholdPct = 0.9, minDistanceM = 2000,
): AnchorRun[] {
  const hrCutoff = estimatedHrmax * hrThresholdPct;
  const anchors: AnchorRun[] = [];
  for (const run of runs) {
    const avgHr = run.avg_hr || 0, distanceM = run.distance_m || 0, durationS = run.duration_s || 0;
    if (avgHr < hrCutoff || distanceM < minDistanceM || durationS <= 0) continue;
    anchors.push({ ...run, vdot: vdotFromRace(distanceM, durationS) });
  }
  anchors.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return anchors;
}

/** Load running-activity anchors from garmin_activity_raw. Port of load_anchors_from_db. */
export async function loadAnchorsFromDb(sql: QueryFn, estimatedHrmax = 190): Promise<AnchorRun[]> {
  const rows = await sql`
    SELECT activity_id, raw_json FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
      AND raw_json->'activityType'->>'typeKey' = 'running'
    ORDER BY (raw_json->>'startTimeLocal')::date ASC`;
  const runs: RunInput[] = [];
  for (const row of rows) {
    const d = typeof row.raw_json === "string" ? JSON.parse(row.raw_json) : row.raw_json;
    const avgHr = d.averageHR, distanceM = d.distance, durationS = d.duration, startLocal = d.startTimeLocal || "";
    if (!avgHr || !distanceM || !durationS || !startLocal) continue;
    runs.push({
      date: String(startLocal).slice(0, 10),
      avg_hr: Number(avgHr), distance_m: Number(distanceM), duration_s: Number(durationS),
      activity_id: row.activity_id,
    });
  }
  return detectAnchorRuns(runs, estimatedHrmax);
}

/**
 * Load daily training loads from training_load with the SAME cross-modal scaling
 * as the PMC, gap-filled with 0. Returns [dailyLoads, minDate]. Port of
 * _load_daily_loads_from_db.
 */
export async function loadDailyLoadsFromDb(sql: QueryFn): Promise<[DailyLoad[], string]> {
  const rows = await sql`
    SELECT activity_date::text AS activity_date, source, load_value
    FROM training_load ORDER BY activity_date`;
  if (!rows.length) return [[], ""];

  const loadByDate = new Map<string, number>();
  for (const row of rows) {
    const scale = crossModalScale(row.source);
    loadByDate.set(row.activity_date, (loadByDate.get(row.activity_date) ?? 0) + Number(row.load_value) * scale);
  }
  const keys = [...loadByDate.keys()].sort();
  const startDate = keys[0], endDate = keys[keys.length - 1];
  const dailyLoads: DailyLoad[] = [];
  for (let cur = startDate; cur <= endDate; cur = new Date(Date.parse(cur + "T00:00:00Z") + 86_400_000).toISOString().slice(0, 10)) {
    dailyLoads.push([daysBetween(startDate, cur), loadByDate.get(cur) ?? 0]);
  }
  return [dailyLoads, startDate];
}

export interface BanisterFitResult extends BanisterParams { n_anchors: number; current_vdot: number; }

/**
 * End-to-end Banister fit from DB: load anchors + daily loads, filter anchors to
 * the last 2 years, convert to day indices, fit, predict today's VDOT, and store
 * a banister_params row. Port of fit_from_db. Returns the fitted params +
 * n_anchors + current_vdot. DB.
 */
export async function fitFromDb(sql: QueryFn, estimatedHrmax = 190): Promise<BanisterFitResult> {
  let anchors = await loadAnchorsFromDb(sql, estimatedHrmax);
  const [dailyLoads, minDate] = await loadDailyLoadsFromDb(sql);

  const cutoff = new Date(Date.parse(todayNyc() + "T00:00:00Z") - 730 * 86_400_000).toISOString().slice(0, 10);
  const recent = anchors.filter((a) => a.date.slice(0, 10) >= cutoff);
  if (recent.length >= 2) anchors = recent;

  let anchorInputs: Anchor[] = [];
  if (minDate && anchors.length) {
    anchorInputs = anchors.map((a) => ({ day_index: daysBetween(minDate, a.date.slice(0, 10)), vdot: a.vdot }));
  }

  const params = fitBanister(dailyLoads, anchorInputs);
  const todayIdx = minDate ? daysBetween(minDate, todayNyc()) : 0;
  const currentVdot = dailyLoads.length ? banisterPredict(params, dailyLoads, todayIdx) : params.p0;

  await sql`
    INSERT INTO banister_params (p0, k1, k2, tau1, tau2, n_anchors, current_vdot, fitted_at)
    VALUES (${params.p0}, ${params.k1}, ${params.k2}, ${params.tau1}, ${params.tau2},
            ${anchorInputs.length}, ${currentVdot}, NOW())`;

  return { ...params, n_anchors: anchorInputs.length, current_vdot: currentVdot };
}
