/**
 * Load stream / PMC — the two database steps that fill training_load (from
 * Garmin activity raw) and pmc_daily. The formulas (activity load, TRIMP, the
 * EWMA CTL/ATL/TSB curve, cross-modal scaling) live in the banister package
 * and are re-exported here for the callers that always imported them from
 * this module. DB-only, no external writes.
 */
import type { QueryFn } from "./db";
import { computeActivityLoad, computeTrimp, computePmc, crossModalScale, DEFAULT_TAU_CTL, DEFAULT_TAU_ATL } from "banister";

export { computeActivityLoad, computeTrimp, computePmc, crossModalScale, DEFAULT_TAU_CTL, DEFAULT_TAU_ATL };
export type { ActivityLoad, PmcEntry } from "banister";
import type { PmcEntry } from "banister";

const r = (x: number, n: number) => Number(x.toFixed(n)); // Python round(x, n) for n>=1

/** UTC date arithmetic for gap-filling (YYYY-MM-DD only, no TZ drift). */
function addDaysUtc(dateStr: string, days: number): string {
  return new Date(Date.parse(dateStr + "T00:00:00Z") + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Extract per-activity EPOC from garmin_activity_raw summaries into training_load.
 * Port of backfill_load_from_history. Skips activities already present
 * (ON CONFLICT DO NOTHING). Returns the count inserted. DB-only.
 */
export async function backfillLoadFromHistory(sql: QueryFn): Promise<number> {
  // Only read blobs for activities not already in training_load. Existing rows
  // are ON CONFLICT DO NOTHING no-ops below, so the computed result is identical
  // to reading everything — but this avoids re-downloading every 'summary' blob
  // from Neon on every sync run (that full re-read was the dominant network-
  // transfer cost and paused the Free-tier project). If training_load is ever
  // empty, NOT EXISTS matches nothing and the full history is rebuilt as before.
  // ::text on both sides keeps the join type-safe regardless of column types.
  const rows = await sql`
    SELECT g.activity_id, g.raw_json
    FROM garmin_activity_raw g
    WHERE g.endpoint_name = 'summary'
      AND NOT EXISTS (
        SELECT 1 FROM training_load tl
        WHERE tl.activity_id::text = g.activity_id::text
      )`;
  // Build all candidate rows in JS, then batch-insert (a per-row loop is one
  // Neon round-trip per activity — hundreds of them). ON CONFLICT DO NOTHING +
  // RETURNING counts only the genuinely new activities.
  type Tuple = [string, number, string, string, number, number | null, string];
  const tuples: Tuple[] = [];
  for (const row of rows) {
    const raw = typeof row.raw_json === "string" ? JSON.parse(row.raw_json) : row.raw_json;
    const activityDateStr: string | undefined = raw.startTimeLocal;
    if (!activityDateStr) continue;
    const activityType = (raw.activityType || {}).typeKey || "unknown";
    const source = `garmin_${activityType}`;
    const load = computeActivityLoad(raw, source);
    const trimp = computeTrimp(Math.max((raw.duration || 0) / 60, 0), raw.averageHR ?? null, raw.minHR || 50, raw.maxHR || 190);
    const details = JSON.stringify({ activity_type: activityType, original_epoc: raw.activityTrainingLoad ?? null, trimp: trimp !== null ? r(trimp, 1) : null });
    tuples.push([activityDateStr.slice(0, 10), row.activity_id, load.source, load.load_metric, load.load_value, load.duration_seconds === null ? null : Math.trunc(load.duration_seconds), details]);
  }

  const client = sql as unknown as { query(text: string, params: unknown[]): Promise<unknown[]> };
  let inserted = 0;
  const CHUNK = 500; // 7 params/row → 3500 params/chunk, well under the cap
  for (let i = 0; i < tuples.length; i += CHUNK) {
    const chunk = tuples.slice(i, i + CHUNK);
    const params: unknown[] = [];
    const values = chunk.map((t) => {
      const b = params.length;
      params.push(t[0], t[1], t[2], t[3], t[4], t[5], t[6]);
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7}::jsonb)`;
    });
    const res = await client.query(
      `INSERT INTO training_load (activity_date, activity_id, source, load_metric, load_value, duration_seconds, details)
       VALUES ${values.join(",")} ON CONFLICT DO NOTHING RETURNING activity_id`,
      params,
    );
    inserted += res.length;
  }
  return inserted;
}

/**
 * Sum training_load per day (cross-modal scaled), fill rest-day gaps with 0,
 * compute PMC, and upsert pmc_daily. Port of compute_and_store_pmc. DB-only.
 * Returns the PMC entries written. tau defaults to the classic 42/7.
 */
export async function computeAndStorePmc(sql: QueryFn, tauCtl = DEFAULT_TAU_CTL, tauAtl = DEFAULT_TAU_ATL): Promise<PmcEntry[]> {
  const rows = await sql`
    SELECT activity_date::text AS activity_date, source, load_value
    FROM training_load
    ORDER BY activity_date`;
  if (!rows.length) return [];

  const loadByDate = new Map<string, number>();
  for (const row of rows) {
    const scale = crossModalScale(row.source);
    const prev = loadByDate.get(row.activity_date) ?? 0.0;
    loadByDate.set(row.activity_date, prev + Number(row.load_value) * scale);
  }

  const keys = [...loadByDate.keys()].sort();
  const startDate = keys[0], endDate = keys[keys.length - 1];
  const dailyLoads: Array<[string, number]> = [];
  for (let cur = startDate; cur <= endDate; cur = addDaysUtc(cur, 1)) {
    dailyLoads.push([cur, loadByDate.get(cur) ?? 0.0]);
  }

  const pmc = computePmc(dailyLoads, tauCtl, tauAtl);
  // Batch the upsert (matches Python's execute_values): a per-row loop is ~4700
  // sequential Neon round-trips. Chunk to stay well under Postgres' param cap.
  const client = sql as unknown as { query(text: string, params: unknown[]): Promise<unknown[]> };
  const CHUNK = 1000;
  for (let i = 0; i < pmc.length; i += CHUNK) {
    const chunk = pmc.slice(i, i + CHUNK);
    const params: unknown[] = [];
    const rows = chunk.map((e) => {
      const b = params.length;
      params.push(e.date, e.ctl, e.atl, e.tsb, e.daily_load);
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5})`;
    });
    await client.query(
      `INSERT INTO pmc_daily (date, ctl, atl, tsb, daily_load) VALUES ${rows.join(",")}
       ON CONFLICT (date) DO UPDATE SET ctl=EXCLUDED.ctl, atl=EXCLUDED.atl, tsb=EXCLUDED.tsb, daily_load=EXCLUDED.daily_load`,
      params,
    );
  }
  return pmc;
}
