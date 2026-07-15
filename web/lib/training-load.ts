/**
 * Strength training load — TS port of sync/src/training_engine/strength_load.py
 * + the _compute_hevy_loads DB step. Estimates a session load (sRPE × duration)
 * and a cross-modal load for the training PMC, from a Hevy workout's sets.
 * Pure formula + a DB step that fills the training_load table. Stage: training
 * engine, part 1 (#187). DB-only, no external side effects.
 */
import type { QueryFn } from "./db";

const r = (x: number, n: number) => Number(x.toFixed(n)); // Python round(x, n) for n>=1

/** Running-relevance factors (ordered; first substring match wins, like the Python dict). */
const RUNNING_RELEVANCE: Array<[string, number]> = [
  ["squat", 1.0], ["barbell squat", 1.0], ["back squat", 1.0], ["front squat", 1.0],
  ["deadlift", 1.0], ["romanian deadlift", 1.0], ["rdl", 1.0], ["leg press", 1.0],
  ["lunge", 1.0], ["walking lunge", 1.0], ["bulgarian split squat", 1.0],
  ["leg curl", 0.8], ["leg extension", 0.8], ["calf raise", 0.8], ["hip thrust", 0.8], ["glute bridge", 0.8],
  ["plank", 0.5], ["ab wheel", 0.5], ["hanging leg raise", 0.5], ["cable crunch", 0.5], ["crunch", 0.5], ["leg raise", 0.5],
  ["bench press", 0.2], ["overhead press", 0.2], ["incline bench press", 0.2],
  ["pull up", 0.3], ["chin up", 0.3], ["chest dip", 0.3], ["barbell row", 0.3], ["dumbbell row", 0.3],
  ["lat pulldown", 0.2], ["chest fly", 0.2], ["bicep curl", 0.1], ["hammer curl", 0.1], ["preacher curl", 0.1],
  ["tricep extension", 0.1], ["triceps pushdown", 0.1], ["lateral raise", 0.1],
];
const CROSS_MODAL_SCALE = 0.5;

/** Epley 1RM = weight × (1 + reps/30); returns the weight itself at 1 rep. */
export function estimate1rm(weightKg: number, reps: number): number {
  if (reps <= 0 || weightKg <= 0) return 0.0;
  if (reps === 1) return weightKg;
  return weightKg * (1 + reps / 30);
}

/** RPE from %1RM + reps via the Zourdos RIR-RPE approach (inverted Epley). */
export function estimateRpe(weightKg: number, reps: number, estimated1rm: number): number {
  if (estimated1rm <= 0) return 5.0;
  const pct = weightKg / estimated1rm;
  if (pct >= 1.0) return 10.0;
  const maxReps = 30 * (1 / pct - 1);
  const rir = Math.max(0, maxReps - reps);
  const rpe = 10 - rir;
  return Math.max(1.0, Math.min(10.0, r(rpe, 1)));
}

/** Running-relevance factor for an exercise (case-insensitive, partial match; default 0.3). */
export function getRunningRelevance(name: string): number {
  const n = name.toLowerCase().trim();
  for (const [key, val] of RUNNING_RELEVANCE) if (key === n) return val;
  for (const [key, val] of RUNNING_RELEVANCE) if (n.includes(key) || key.includes(n)) return val;
  return 0.3;
}

export interface StrengthSet { weight_kg?: number | null; reps?: number | null; }
export interface StrengthExercise { name?: string; sets?: StrengthSet[]; }
export interface StrengthLoad { load_value: number; session_rpe: number; running_relevance: number; cross_modal_load: number; }

/** Compute session load for a strength workout (sRPE × duration + cross-modal load). */
export function computeStrengthLoad(exercises: StrengthExercise[], durationMin: number): StrengthLoad {
  const zero: StrengthLoad = { load_value: 0, session_rpe: 0, running_relevance: 0, cross_modal_load: 0 };
  if (!exercises.length || durationMin <= 0) return zero;

  let totalVl = 0, weightedRpe = 0, weightedRel = 0;
  for (const ex of exercises) {
    const sets = ex.sets ?? [];
    if (!sets.length) continue;
    const relevance = getRunningRelevance(ex.name ?? "");
    let best1rm = 0;
    for (const s of sets) best1rm = Math.max(best1rm, estimate1rm(s.weight_kg ?? 0, s.reps ?? 0));
    for (const s of sets) {
      const w = s.weight_kg ?? 0, rep = s.reps ?? 0;
      if (w <= 0 || rep <= 0) continue;
      const setVl = w * rep;
      totalVl += setVl;
      weightedRpe += estimateRpe(w, rep, best1rm) * setVl;
      weightedRel += relevance * setVl;
    }
  }
  if (totalVl <= 0) return zero;

  const sessionRpe = weightedRpe / totalVl;
  const runningRelevance = weightedRel / totalVl;
  const loadValue = sessionRpe * durationMin;
  return {
    load_value: r(loadValue, 2),
    session_rpe: r(sessionRpe, 2),
    running_relevance: r(runningRelevance, 4),
    cross_modal_load: r(loadValue * runningRelevance * CROSS_MODAL_SCALE, 2),
  };
}

/** Extract exercises (with weighted sets) from a Hevy workout's raw JSON. */
function extractExercises(raw: any): StrengthExercise[] {
  const out: StrengthExercise[] = [];
  for (const ex of raw?.exercises ?? []) {
    const sets: StrengthSet[] = [];
    for (const s of ex.sets ?? []) {
      const weight = s.weight_kg || 0, reps = s.reps || 0;
      if (weight > 0 && reps > 0) sets.push({ weight_kg: weight, reps });
    }
    if (sets.length) out.push({ name: ex.title ?? "", sets });
  }
  return out;
}

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
