/**
 * Hevy enrichment orchestration — TS port of activity_replacer.enrich_new_workouts.
 * SAFE: resolves HR + calories and writes workout_enrichment, then matches to
 * existing Garmin activities. NO Garmin upload. Stage 2 (#184).
 */
import { calcCalories, DEFAULT_PROFILE } from "hevy2garmin";
import type { QueryFn } from "./db";
import { getDailyHrForWindow, resolveHrDecision, MIN_EXERCISE_HR, FALLBACK_HR_WINDOW } from "./hevy-enrich";
import { populateGarminIds, toUtcDate } from "./hevy-match";

export interface HevyWorkoutRow { hevyId: string; hevyTitle: string | null; workout: any; date: string; }
export interface ExistingEnrichment { hrSource: string | null; garminActivityId: number | null; }

/** Load all Hevy workouts from hevy_raw_data, newest-first. */
export async function getAllHevyWorkouts(sql: QueryFn): Promise<HevyWorkoutRow[]> {
  const rows = await sql`
    SELECT raw_json->>'id' AS hevy_id, raw_json->>'title' AS hevy_title, raw_json AS workout
    FROM hevy_raw_data WHERE endpoint_name = 'workout'
    ORDER BY raw_json->>'start_time' DESC`;
  return rows.map((r) => {
    const w = typeof r.workout === "string" ? JSON.parse(r.workout) : r.workout;
    const start: string = w.start_time ?? "";
    return { hevyId: r.hevy_id, hevyTitle: r.hevy_title, workout: w, date: start ? start.slice(0, 10) : "unknown" };
  });
}

/**
 * Split workouts into those needing (re)enrichment. Pure port of the new+stale
 * selection: new = no enrichment row; stale = has a non-"daily" HR source and is
 * within the last 7 days (worth retrying now that daily HR may have arrived).
 */
export function selectToEnrich(
  workouts: HevyWorkoutRow[],
  existing: Map<string, ExistingEnrichment>,
  staleCutoff: string,
): { newWorkouts: HevyWorkoutRow[]; staleWorkouts: HevyWorkoutRow[] } {
  const newWorkouts = workouts.filter((w) => !existing.has(w.hevyId));
  const staleWorkouts = workouts.filter((w) => {
    const e = existing.get(w.hevyId);
    return e !== undefined && e.hrSource !== "daily" && (w.date >= staleCutoff);
  });
  return { newWorkouts, staleWorkouts };
}

const FIXED_COLS = [
  "hr_source", "avg_hr", "max_hr", "min_hr", "hr_samples", "hr_sample_count",
  "calories", "duration_s", "exercise_count", "total_sets", "hevy_title", "workout_date", "status",
] as const;

async function upsertEnrichment(sql: QueryFn, hevyId: string, f: Record<string, unknown>): Promise<void> {
  await sql`
    INSERT INTO workout_enrichment
      (hevy_id, hr_source, avg_hr, max_hr, min_hr, hr_samples, hr_sample_count,
       calories, duration_s, exercise_count, total_sets, hevy_title, workout_date, status)
    VALUES
      (${hevyId}, ${f.hr_source ?? null}, ${f.avg_hr ?? null}, ${f.max_hr ?? null}, ${f.min_hr ?? null},
       ${JSON.stringify(f.hr_samples ?? [])}::jsonb, ${f.hr_sample_count ?? null},
       ${f.calories ?? null}, ${f.duration_s ?? null}, ${f.exercise_count ?? null}, ${f.total_sets ?? null},
       ${f.hevy_title ?? null}, ${f.workout_date ?? null}, ${f.status ?? "enriched"})
    ON CONFLICT (hevy_id) DO UPDATE SET
      hr_source = EXCLUDED.hr_source, avg_hr = EXCLUDED.avg_hr, max_hr = EXCLUDED.max_hr,
      min_hr = EXCLUDED.min_hr, hr_samples = EXCLUDED.hr_samples, hr_sample_count = EXCLUDED.hr_sample_count,
      calories = EXCLUDED.calories, duration_s = EXCLUDED.duration_s, exercise_count = EXCLUDED.exercise_count,
      total_sets = EXCLUDED.total_sets, hevy_title = EXCLUDED.hevy_title, workout_date = EXCLUDED.workout_date,
      status = EXCLUDED.status, updated_at = NOW()`;
}

const pyRound = (x: number) => { const fl = Math.floor(x), d = x - fl; return d < 0.5 ? fl : d > 0.5 ? fl + 1 : fl % 2 === 0 ? fl : fl + 1; };
const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;

export interface EnrichResult { newCount: number; staleCount: number; enriched: number; matched: number; }

/** Full enrichment pass: resolve HR + calories per workout, upsert, then match to Garmin. */
export async function enrichNewWorkouts(sql: QueryFn, now: Date = new Date()): Promise<EnrichResult> {
  const workouts = await getAllHevyWorkouts(sql);
  if (!workouts.length) return { newCount: 0, staleCount: 0, enriched: 0, matched: 0 };

  const exRows = await sql`SELECT hevy_id, hr_source, garmin_activity_id FROM workout_enrichment`;
  const existing = new Map<string, ExistingEnrichment>();
  for (const r of exRows) existing.set(r.hevy_id, { hrSource: r.hr_source, garminActivityId: r.garmin_activity_id });

  const staleCutoff = new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
  const { newWorkouts, staleWorkouts } = selectToEnrich(workouts, existing, staleCutoff);
  const toEnrich = [...newWorkouts, ...staleWorkouts];
  if (!toEnrich.length) return { newCount: 0, staleCount: 0, enriched: 0, matched: 0 };

  // Recent real-HR averages, for the fallback path.
  const avgRows = await sql`
    SELECT avg_hr FROM workout_enrichment
    WHERE hr_source = 'daily' AND avg_hr >= ${MIN_EXERCISE_HR}
    ORDER BY workout_date DESC LIMIT ${FALLBACK_HR_WINDOW}`;
  const recentHrAvgs: number[] = avgRows.map((r) => Number(r.avg_hr)).filter((n) => !isNaN(n));

  let enriched = 0;
  for (const w of toEnrich) {
    try {
      const hw = w.workout;
      const oldSource = existing.get(w.hevyId)?.hrSource ?? null;
      const start = hw.start_time ?? "";
      const end = hw.end_time ?? "";
      if (!start || !end) continue;

      let hr: number[] = [];
      let hrSource = "";
      if (start && end) {
        hr = await getDailyHrForWindow(sql, start, end);
        if (hr.length && mean(hr) >= MIN_EXERCISE_HR) hrSource = "daily";
        else hr = [];
      }
      if (!hr.length) {
        const res = resolveHrDecision([], recentHrAvgs);
        hr = res.samples; hrSource = res.source;
      }

      // Stale workout with no improvement in HR source: skip.
      if (oldSource && hrSource === oldSource) continue;

      const startDt = toUtcDate(start), endDt = toUtcDate(end);
      if (!startDt || !endDt) continue;
      const durationS = (endDt.getTime() - startDt.getTime()) / 1000;
      const calories = calcCalories(hr, durationS, startDt.getUTCFullYear(), DEFAULT_PROFILE);

      const exercises: any[] = hw.exercises ?? [];
      const totalSets = exercises.reduce((s, ex) => s + (ex.sets?.length ?? 0), 0);
      const avgHr = hr.length ? pyRound(mean(hr)) : null;

      await upsertEnrichment(sql, w.hevyId, {
        hr_source: hrSource, avg_hr: avgHr,
        max_hr: hr.length ? Math.max(...hr) : null, min_hr: hr.length ? Math.min(...hr) : null,
        hr_samples: hr, hr_sample_count: hr.length, calories, duration_s: durationS,
        exercise_count: exercises.length, total_sets: totalSets,
        hevy_title: w.hevyTitle, workout_date: w.date, status: "enriched",
      });
      enriched += 1;
      if (hrSource === "daily" && avgHr && avgHr >= MIN_EXERCISE_HR) recentHrAvgs.unshift(avgHr);
    } catch (e) {
      console.warn(`    Error enriching ${w.hevyId}: ${(e as Error).message}`);
    }
  }

  const matched = enriched > 0 ? await populateGarminIds(sql) : 0;
  return { newCount: newWorkouts.length, staleCount: staleWorkouts.length, enriched, matched };
}
