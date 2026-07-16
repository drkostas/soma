/**
 * Hevy workout enrichment — HR resolution + window filtering. TS port of the
 * safe (no-upload) core of activity_replacer.py (resolve_hr_samples +
 * get_daily_hr_for_window). Writes only workout_enrichment downstream; the
 * FIT upload to Garmin is a separate, dedup-gated step. Stage 2 (#184).
 */
import { DEFAULT_HR_BPM } from "hevy2garmin";
import type { QueryFn } from "./db";

export const FALLBACK_HR_WINDOW = 10; // avg of last N workouts with HR
export const MIN_EXERCISE_HR = 65;    // below this, daily HR is likely resting

/** Python round() at ndigits=0: round-half-to-even, but only on an exact .5. */
function pyRound(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

const mean = (xs: number[]): number => xs.reduce((s, v) => s + v, 0) / xs.length;

/**
 * Extract HR values whose timestamp falls in [startMs, endMs] from raw
 * heart_rates JSON rows. Pure port of get_daily_hr_for_window's filter.
 */
export function filterHrInWindow(rawJsons: any[], startMs: number, endMs: number): number[] {
  const out: number[] = [];
  for (const raw of rawJsons) {
    const values = raw?.heartRateValues ?? [];
    for (const entry of values) {
      if (
        Array.isArray(entry) && entry.length >= 2 &&
        entry[0] !== null && entry[0] !== undefined &&
        entry[1] !== null && entry[1] !== undefined &&
        startMs <= entry[0] && entry[0] <= endMs
      ) out.push(Math.trunc(entry[1]));
    }
  }
  return out;
}

export interface HrResolution {
  samples: number[];
  /** "daily" | "avg_N" | "static" */
  source: string;
}

/**
 * Resolve HR samples for a workout from already-fetched daily HR + recent
 * averages. Pure port of resolve_hr_samples' decision:
 *  1. daily HR when its mean >= MIN_EXERCISE_HR,
 *  2. else 30 synthetic samples at the mean of the last N workout averages,
 *  3. else 30 samples at DEFAULT_HR_BPM.
 */
export function resolveHrDecision(dailyHr: number[], recentAvgs: number[]): HrResolution {
  if (dailyHr.length && mean(dailyHr) >= MIN_EXERCISE_HR) {
    return { samples: dailyHr, source: "daily" };
  }
  if (recentAvgs.length >= 1) {
    const window = recentAvgs.slice(0, FALLBACK_HR_WINDOW);
    const avgHr = pyRound(mean(window));
    return { samples: Array(30).fill(avgHr), source: `avg_${window.length}` };
  }
  return { samples: Array(30).fill(DEFAULT_HR_BPM), source: "static" };
}

/** UTC dates (YYYY-MM-DD) to scan for a window: day before, day of, day after. */
export function windowDates(startUtc: string): string[] {
  const d = new Date(startUtc.replace("Z", "+00:00"));
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const oneDay = 86_400_000;
  return [day - oneDay, day, day + oneDay].map((ms) => new Date(ms).toISOString().slice(0, 10));
}

/**
 * Fetch HR samples from Garmin daily monitoring during [startUtc, endUtc].
 * Scans the day before/of/after (UTC) to absorb timezone offsets.
 */
export async function getDailyHrForWindow(sql: QueryFn, startUtc: string, endUtc: string): Promise<number[]> {
  const startMs = new Date(startUtc.replace("Z", "+00:00")).getTime();
  const endMs = new Date(endUtc.replace("Z", "+00:00")).getTime();
  const dates = windowDates(startUtc);
  const rows = await sql`
    SELECT raw_json FROM garmin_raw_data
    WHERE endpoint_name = 'heart_rates' AND date = ANY(${dates}::date[])`;
  const raws = rows.map((r) => (typeof r.raw_json === "string" ? JSON.parse(r.raw_json) : r.raw_json));
  return filterHrInWindow(raws, startMs, endMs);
}
