/** Strength load, DB half: training_load rows from Hevy workouts. The 1RM/RPE/load formulas live in banister. */
import type { QueryFn } from "./db";
import { estimate1rm, estimateRpe, getRunningRelevance, computeStrengthLoad, extractExercises } from "banister";
export { estimate1rm, estimateRpe, getRunningRelevance, computeStrengthLoad } from "banister";
export type { StrengthSet, StrengthExercise, StrengthLoad } from "banister";

/**
 * Compute training_load rows for Hevy workouts not yet in the table.
 * Port of _compute_hevy_loads. Returns the count inserted. DB-only.
 */
export async function computeHevyLoads(sql: QueryFn): Promise<number> {
  const rows = await sql`
    SELECT h.id, h.raw_json
    FROM hevy_raw_data h
    WHERE h.endpoint_name = 'workout'
      AND NOT EXISTS (SELECT 1 FROM training_load t WHERE t.hevy_id = h.id::text)`;
  let inserted = 0;
  for (const row of rows) {
    const raw = typeof row.raw_json === "string" ? JSON.parse(row.raw_json) : row.raw_json;
    const exercises = extractExercises(raw);
    if (!exercises.length) continue;

    const start = raw.start_time ?? "", end = raw.end_time ?? "";
    let durationMin = 45;
    if (start && end) {
      const t0 = Date.parse(start), t1 = Date.parse(end);
      if (!isNaN(t0) && !isNaN(t1)) durationMin = Math.max(1, (t1 - t0) / 60000);
    }
    const dateStr = String(start).slice(0, 10);
    if (!dateStr) continue;

    const load = computeStrengthLoad(exercises, durationMin);
    await sql`
      INSERT INTO training_load (activity_date, hevy_id, source, load_metric, load_value, duration_seconds, details)
      VALUES (${dateStr}, ${String(row.id)}, 'hevy', 'srpe', ${load.cross_modal_load}, ${Math.trunc(durationMin * 60)},
        ${JSON.stringify({ session_rpe: load.session_rpe, running_relevance: load.running_relevance, raw_load: load.load_value })}::jsonb)
      ON CONFLICT DO NOTHING`;
    inserted += 1;
  }
  return inserted;
}
