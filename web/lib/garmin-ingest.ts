/**
 * Garmin ingestion — TS port of sync/src/garmin_sync.py + pipeline._get_stale_dates.
 * Runs as a Vercel cron (#183), alongside the Python sync during the incremental
 * cutover. Idempotent upserts into garmin_raw_data / garmin_activity_raw, so
 * running both is safe (last writer wins, same rows).
 *
 * Auth: garmin-auth GarminAuth + DBTokenStore (default platform `garmin_tokens`,
 * matching soma's fresh main-account DI tokens). connectapi paths carry query
 * params inline (the TS client's connectapi(path) takes no separate params arg).
 */
import { GarminAuth, DBTokenStore, type GarminClient } from "garmin-auth";
import type { QueryFn } from "./db";
import {
  DAILY_ENDPOINTS, RANGE_ENDPOINTS, DISCOVERY_ENDPOINTS, ACTIVITY_DETAIL_ENDPOINTS,
  buildRequest, type GarminRequest,
} from "./garmin-endpoints";
import { processDay } from "./garmin-parse-day";
import { updateFitnessTrajectory } from "./fitness-stream";
import { computeDailyReadiness } from "./readiness-stream";
import { updateBodyComp } from "./body-comp-stream";

const MIN_COMPLETE_HR_POINTS = 650;
// DI-token API profile path (returns displayName). garth's web API uses
// /userprofile/profile, but the DI/native-app token 404s there — socialProfile
// is the DI-compatible path (same one garmin-auth's own refresh() uses).
const PROFILE_URL = "/userprofile-service/socialProfile";

/** Today's date (YYYY-MM-DD) in America/New_York — mirrors config.today_nyc. */
export function todayNyc(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/** Serialize a GarminRequest into a connectapi path with an inline query string. */
export function toPath(req: GarminRequest): string {
  if (!req.params) return req.url;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(req.params)) qs.set(k, String(v));
  return `${req.url}?${qs.toString()}`;
}

/** Python `if data:` — treat empty dict/array/null/undefined as "no data". */
function hasData(d: unknown): boolean {
  if (d === null || d === undefined) return false;
  if (Array.isArray(d)) return d.length > 0;
  if (typeof d === "object") return Object.keys(d as object).length > 0;
  return Boolean(d);
}

async function upsertRaw(sql: QueryFn, date: string, endpoint: string, data: unknown): Promise<void> {
  await sql`
    INSERT INTO garmin_raw_data (date, endpoint_name, raw_json)
    VALUES (${date}, ${endpoint}, ${JSON.stringify(data)}::jsonb)
    ON CONFLICT (date, endpoint_name)
    DO UPDATE SET raw_json = EXCLUDED.raw_json, synced_at = NOW()`;
}

async function upsertActivityRaw(sql: QueryFn, activityId: number, endpoint: string, data: unknown): Promise<void> {
  await sql`
    INSERT INTO garmin_activity_raw (activity_id, endpoint_name, raw_json)
    VALUES (${activityId}, ${endpoint}, ${JSON.stringify(data)}::jsonb)
    ON CONFLICT (activity_id, endpoint_name)
    DO UPDATE SET raw_json = EXCLUDED.raw_json, synced_at = NOW()`;
}

/**
 * Find dates needing a re-sync (incomplete HR or partial health summary).
 * Today is always included. Port of pipeline._get_stale_dates.
 */
export async function getStaleDates(sql: QueryFn, maxLookback = 14, now: Date = new Date()): Promise<string[]> {
  const today = todayNyc(now);
  const stale = new Set<string>([today]);
  const dayMs = 86_400_000;
  const todayMs = Date.parse(today + "T00:00:00Z");

  // Check 1: HR completeness — find the most recent complete day, include everything after it.
  const hrRows = await sql`
    SELECT date::text AS date,
           CASE WHEN jsonb_typeof(raw_json->'heartRateValues') = 'array'
                THEN jsonb_array_length(raw_json->'heartRateValues') ELSE 0 END AS pts
    FROM garmin_raw_data
    WHERE endpoint_name = 'heart_rates'
      AND date >= CURRENT_DATE - ${maxLookback}::int
      AND date < CURRENT_DATE
    ORDER BY date DESC`;
  let foundComplete = false;
  for (const row of hrRows) {
    if (Number(row.pts) >= MIN_COMPLETE_HR_POINTS && !foundComplete) {
      foundComplete = true;
      const daysBack = Math.round((todayMs - Date.parse(row.date + "T00:00:00Z")) / dayMs);
      for (let i = 0; i < daysBack; i++) stale.add(new Date(todayMs - i * dayMs).toISOString().slice(0, 10));
      break;
    }
  }
  if (!foundComplete) {
    for (let i = 0; i < maxLookback; i++) stale.add(new Date(todayMs - i * dayMs).toISOString().slice(0, 10));
  }

  // Check 2: health summaries with suspiciously low values (partial sync).
  const partial = await sql`
    SELECT date::text AS date FROM daily_health_summary
    WHERE date >= CURRENT_DATE - 7 AND date < CURRENT_DATE
      AND (bmr_kilocalories < 1500 OR total_steps < 1000)`;
  for (const row of partial) stale.add(row.date);

  return [...stale].sort().reverse();
}

/** Sync all daily + range endpoints for one date. Returns count of records saved. */
export async function syncDay(client: GarminClient, sql: QueryFn, display: string, date: string): Promise<number> {
  let count = 0;
  const groups = [DAILY_ENDPOINTS, RANGE_ENDPOINTS];
  for (const group of groups) {
    for (const [name, spec] of Object.entries(group)) {
      try {
        const req = buildRequest(spec, { display, cdate: date });
        const data = await client.connectapi(toPath(req));
        if (hasData(data)) {
          await upsertRaw(sql, date, name, data);
          count += 1;
        }
      } catch (e) {
        console.warn(`  Warning: ${name} failed for ${date}: ${(e as Error).message}`);
      }
    }
  }
  return count;
}

/**
 * Fetch the per-activity detail endpoints (splits, HR zones, weather, gear, …) and
 * upsert to garmin_activity_raw. Skips activities that already have details stored,
 * so it only fetches new ones (avoids re-hitting the API + rate limits). Mirrors
 * garmin_sync.sync_activity_details. Returns the count of detail endpoints saved.
 */
export async function syncActivityDetails(client: GarminClient, sql: QueryFn, activityId: number): Promise<number> {
  const seen = await sql`
    SELECT 1 FROM garmin_activity_raw WHERE activity_id = ${activityId} AND endpoint_name = 'details' LIMIT 1`;
  if (seen.length) return 0; // already fetched
  let count = 0;
  for (const [name, spec] of Object.entries(ACTIVITY_DETAIL_ENDPOINTS)) {
    try {
      const req = buildRequest(spec, { aid: activityId });
      const data = await client.connectapi(toPath(req));
      if (hasData(data)) { await upsertActivityRaw(sql, activityId, name, data); count += 1; }
    } catch (e) {
      console.warn(`  Warning: ${name} failed for activity ${activityId}: ${(e as Error).message}`);
    }
  }
  return count;
}

/** Discover activities for a date, store list + per-activity summaries + details, return ids. */
export async function syncActivitiesForDate(client: GarminClient, sql: QueryFn, date: string): Promise<number[]> {
  try {
    const req = buildRequest(DISCOVERY_ENDPOINTS.activities_list, { cdate: date });
    const activities = (await client.connectapi(toPath(req))) as Array<Record<string, any>>;
    if (!activities || !activities.length) return [];
    await upsertRaw(sql, date, "activities_list", activities);
    const ids: number[] = [];
    for (const a of activities) {
      const aid = a.activityId;
      if (aid) {
        await upsertActivityRaw(sql, aid, "summary", a);
        await syncActivityDetails(client, sql, aid);
        ids.push(aid);
      }
    }
    return ids;
  } catch (e) {
    console.warn(`  Warning: activities_list failed for ${date}: ${(e as Error).message}`);
    return [];
  }
}

export interface IngestResult {
  displayName: string;
  dates: string[];
  recordsSaved: number;
  activitiesFound: number;
  daysParsed: number;
  fitnessUpdated: boolean;
  readiness: string | null;
}

/** Top-level ingestion: auth, resolve stale dates, sync each. */
export async function runGarminIngest(databaseUrl: string, sql: QueryFn): Promise<IngestResult> {
  const auth = new GarminAuth({ store: new DBTokenStore(databaseUrl) });
  const client = await auth.client();
  const profile = (await client.connectapi(PROFILE_URL)) as { displayName?: string };
  const display = profile?.displayName;
  if (!display) throw new Error("Garmin profile has no displayName");

  const dates = await getStaleDates(sql);
  let recordsSaved = 0;
  let activitiesFound = 0;
  let daysParsed = 0;
  for (const date of dates) {
    recordsSaved += await syncDay(client, sql, display, date);
    activitiesFound += (await syncActivitiesForDate(client, sql, date)).length;
    // Parse the raw we just fetched into the structured tables (daily_health_summary,
    // sleep_detail, weight_log) — completes fetch→parse in TS.
    try { const r = await processDay(sql, date); if (r.health) daysParsed += 1; }
    catch (e) { console.warn(`  parse failed for ${date}: ${(e as Error).message}`); }
  }
  // Fitness trajectory (VO2max / EF / decoupling / race prediction) for today —
  // uses the raw + parsed data just ingested. Non-fatal on failure.
  let fitnessUpdated = false;
  try {
    const traj = await updateFitnessTrajectory(sql, todayNyc());
    fitnessUpdated = traj !== null;
  } catch (e) { console.warn(`  fitness trajectory failed: ${(e as Error).message}`); }

  // Body composition: 7-day weight EMA + weight-adjusted VDOT / race prediction.
  // Runs AFTER the fitness trajectory (needs its vo2max) and overwrites weight_kg
  // with the smoothed value. Non-fatal on failure.
  try { await updateBodyComp(sql, todayNyc()); }
  catch (e) { console.warn(`  body comp failed: ${(e as Error).message}`); }

  // Daily readiness (traffic light from HRV/sleep/RHR/body-battery z-scores) for
  // today — reads the daily_health_summary just parsed. Non-fatal on failure.
  let readiness: string | null = null;
  try {
    const rd = await computeDailyReadiness(sql, todayNyc());
    readiness = rd.traffic_light;
  } catch (e) { console.warn(`  readiness failed: ${(e as Error).message}`); }

  return { displayName: display, dates, recordsSaved, activitiesFound, daysParsed, fitnessUpdated, readiness };
}
