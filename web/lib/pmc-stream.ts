/**
 * Load stream / PMC — TS port of sync/src/training_engine/load_stream.py.
 * Turns per-activity load into the fitness/fatigue/form (CTL/ATL/TSB) curve the
 * dashboard graphs. Pure formulas (EPOC load, TRIMP, EWMA PMC, cross-modal
 * scaling) + two DB steps that fill training_load (from Garmin activity raw) and
 * pmc_daily. Stage: training engine, part 2 (#187). DB-only, no external writes.
 *
 * EWMA: value_today = load * alpha + value_yesterday * (1 - alpha),
 *       alpha = 1 - exp(-1/tau); CTL tau = 42, ATL tau = 7; TSB = CTL - ATL.
 */
import type { QueryFn } from "./db";

const r = (x: number, n: number) => Number(x.toFixed(n)); // Python round(x, n) for n>=1

export interface ActivityLoad {
  load_metric: string;
  load_value: number;
  source: string;
  duration_seconds: number | null;
}

/**
 * Extract or compute load from a single activity. Primary: Garmin EPOC
 * (activityTrainingLoad). Fallback: ~1.5 EPOC/min duration estimate, or 50.0.
 */
export function computeActivityLoad(raw: Record<string, any>, source: string): ActivityLoad {
  const epoc = raw.activityTrainingLoad;
  if (epoc !== null && epoc !== undefined && epoc > 0) {
    return {
      load_metric: "epoc",
      load_value: Number(epoc),
      source,
      duration_seconds: raw.duration ?? null,
    };
  }
  const durationSec = raw.duration || 0;
  const durationMin = Math.max(durationSec / 60.0, 0);
  const estimated = durationMin > 0 ? r(durationMin * 1.5, 1) : 50.0;
  return {
    load_metric: "estimated",
    load_value: estimated,
    source,
    duration_seconds: raw.duration ?? null,
  };
}

/**
 * Banister TRIMP from average HR.
 * TRIMP = duration(min) × ratio × 0.64 × e^(1.92 × ratio),
 * ratio = clamp((HR - HR_rest) / (HR_max - HR_rest), 0, 1). null if no HR.
 */
export function computeTrimp(
  durationMin: number,
  avgHr: number | null,
  restingHr: number,
  maxHr: number,
): number | null {
  if (avgHr === null || avgHr === undefined) return null;
  if (maxHr <= restingHr || durationMin <= 0) return 0.0;
  let ratio = (avgHr - restingHr) / (maxHr - restingHr);
  ratio = Math.max(0.0, Math.min(1.0, ratio));
  return durationMin * ratio * 0.64 * Math.exp(1.92 * ratio);
}

export interface PmcEntry { date: string; ctl: number; atl: number; tsb: number; daily_load: number; }

/** Compute PMC from chronological (date, dailyLoad) pairs sorted ascending. */
export function computePmc(
  dailyLoads: Array<[string, number]>,
  tauCtl = 42,
  tauAtl = 7,
): PmcEntry[] {
  if (!dailyLoads.length) return [];
  const alphaCtl = 1 - Math.exp(-1 / tauCtl);
  const alphaAtl = 1 - Math.exp(-1 / tauAtl);
  const results: PmcEntry[] = [];
  let ctl = 0.0, atl = 0.0;
  for (const [dt, load] of dailyLoads) {
    ctl = load * alphaCtl + ctl * (1 - alphaCtl);
    atl = load * alphaAtl + atl * (1 - alphaAtl);
    results.push({ date: dt, ctl: r(ctl, 2), atl: r(atl, 2), tsb: r(ctl - atl, 2), daily_load: load });
  }
  return results;
}

/** Scale factor for non-running activities entering the running PMC. */
export function crossModalScale(source: string): number {
  const s = source.toLowerCase();
  if (s.includes("running") || s.includes("treadmill")) return 1.0;
  if (s === "hevy") return 1.0; // already cross-modal scaled (0.5×) before insertion
  if (s.includes("cycling") || s.includes("bike")) return 0.6;
  if (s.includes("walking")) return 0.2;
  if (s.includes("swimming") || s.includes("lap_swimming")) return 0.5;
  return 0.3;
}

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
  const rows = await sql`
    SELECT activity_id, raw_json
    FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'`;
  let inserted = 0;
  for (const row of rows) {
    const raw = typeof row.raw_json === "string" ? JSON.parse(row.raw_json) : row.raw_json;
    const activityDateStr: string | undefined = raw.startTimeLocal;
    if (!activityDateStr) continue;
    const activityDate = activityDateStr.slice(0, 10);
    const activityType = (raw.activityType || {}).typeKey || "unknown";
    const source = `garmin_${activityType}`;
    const load = computeActivityLoad(raw, source);

    const trimp = computeTrimp(
      Math.max((raw.duration || 0) / 60, 0),
      raw.averageHR ?? null,
      raw.minHR || 50,
      raw.maxHR || 190,
    );

    const details = JSON.stringify({
      activity_type: activityType,
      original_epoc: raw.activityTrainingLoad ?? null,
      trimp: trimp !== null ? r(trimp, 1) : null,
    });
    // RETURNING so the result array is non-empty only on a real insert
    // (ON CONFLICT DO NOTHING yields [] when the activity is already present).
    const res = await sql`
      INSERT INTO training_load
        (activity_date, activity_id, source, load_metric, load_value, duration_seconds, details)
      VALUES (${activityDate}, ${row.activity_id}, ${load.source}, ${load.load_metric},
              ${load.load_value}, ${load.duration_seconds === null ? null : Math.trunc(load.duration_seconds)},
              ${details}::jsonb)
      ON CONFLICT DO NOTHING
      RETURNING activity_id`;
    if (res.length > 0) inserted += 1;
  }
  return inserted;
}

/**
 * Sum training_load per day (cross-modal scaled), fill rest-day gaps with 0,
 * compute PMC, and upsert pmc_daily. Port of compute_and_store_pmc. DB-only.
 * Returns the PMC entries written.
 */
export async function computeAndStorePmc(sql: QueryFn, tauCtl = 42, tauAtl = 7): Promise<PmcEntry[]> {
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
  for (const e of pmc) {
    await sql`
      INSERT INTO pmc_daily (date, ctl, atl, tsb, daily_load)
      VALUES (${e.date}, ${e.ctl}, ${e.atl}, ${e.tsb}, ${e.daily_load})
      ON CONFLICT (date) DO UPDATE SET
        ctl = EXCLUDED.ctl, atl = EXCLUDED.atl, tsb = EXCLUDED.tsb, daily_load = EXCLUDED.daily_load`;
  }
  return pmc;
}
