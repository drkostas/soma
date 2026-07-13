/**
 * Match Hevy workouts to EXISTING Garmin strength activities by timestamp —
 * TS port of activity_replacer._populate_garmin_ids. Safe: only updates
 * workout_enrichment.garmin_activity_id (marks a workout as already-on-Garmin
 * so it is NOT re-uploaded). No Garmin writes. A dedup layer for Stage 2 (#184).
 */
import type { QueryFn } from "./db";

export interface HevyDt { hevyId: string; date: Date; }
export interface GarminAct { gmt: string; aid: number; } // gmt = "YYYY-MM-DD HH:MM:SS"

/** Format a Date as Garmin's naive-UTC "YYYY-MM-DD HH:MM:SS". */
function gmtStr(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

const SIX_HOURS_MS = 6 * 3600 * 1000;

/**
 * Two-pass match, faithful to the Python:
 *  1. exact GMT-string match, else scan offsets -60..+60s (first hit wins),
 *  2. else the closest Garmin activity within ±6h (Hevy local-time-as-UTC offset).
 * Returns the hevyId → garmin activity_id pairs that matched.
 */
export function matchHevyToGarmin(hevyDts: HevyDt[], garminActs: GarminAct[]): Array<{ hevyId: string; aid: number }> {
  const byTime = new Map<string, number>();
  for (const g of garminActs) byTime.set(g.gmt, g.aid);
  const acts = garminActs.map((g) => ({ ms: Date.parse(g.gmt + "Z"), aid: g.aid }));

  const out: Array<{ hevyId: string; aid: number }> = [];
  for (const { hevyId, date } of hevyDts) {
    let aid: number | undefined = byTime.get(gmtStr(date));

    if (aid === undefined) { // pass 1: ±60s, first hit scanning from -60
      for (let off = -60; off <= 60; off++) {
        const cand = byTime.get(gmtStr(new Date(date.getTime() + off * 1000)));
        if (cand !== undefined) { aid = cand; break; }
      }
    }

    if (aid === undefined) { // pass 2: closest within ±6h
      const hms = date.getTime();
      let best: { d: number; aid: number } | null = null;
      for (const a of acts) {
        const d = Math.abs(a.ms - hms);
        if (d <= SIX_HOURS_MS && (best === null || d < best.d)) best = { d, aid: a.aid };
      }
      if (best) aid = best.aid;
    }

    if (aid !== undefined) out.push({ hevyId, aid });
  }
  return out;
}

/** Parse a Hevy/Garmin start into a UTC Date (naive strings treated as UTC). */
export function toUtcDate(s: string): Date | null {
  if (!s) return null;
  const iso = s.includes("T") ? s : s.replace(" ", "T");
  const withZone = /[Z+]|[-]\d\d:\d\d$/.test(iso) ? iso : iso + "Z";
  const d = new Date(withZone);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Load Hevy workout times + Garmin strength activities from the DB, match, and
 * mark matched workouts as uploaded (garmin_activity_id set). Returns match count.
 */
export async function populateGarminIds(sql: QueryFn): Promise<number> {
  const hevyRows = await sql`
    SELECT raw_json->>'id' AS hevy_id, raw_json->>'start_time' AS start_time
    FROM hevy_raw_data WHERE endpoint_name = 'workout'`;
  const hevyDts: HevyDt[] = [];
  for (const r of hevyRows) {
    const d = toUtcDate(r.start_time);
    if (d) hevyDts.push({ hevyId: r.hevy_id, date: d });
  }

  const gRows = await sql`
    SELECT activity_id, raw_json->>'startTimeGMT' AS start_gmt
    FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
      AND raw_json->'activityType'->>'typeKey' = 'strength_training'`;
  const garminActs: GarminAct[] = gRows
    .filter((r) => r.start_gmt)
    .map((r) => ({ gmt: r.start_gmt, aid: Number(r.activity_id) }));

  const matches = matchHevyToGarmin(hevyDts, garminActs);
  for (const m of matches) {
    await sql`
      UPDATE workout_enrichment
      SET garmin_activity_id = ${m.aid}, status = 'uploaded', updated_at = NOW()
      WHERE hevy_id = ${m.hevyId}`;
  }
  return matches.length;
}
