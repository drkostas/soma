/**
 * Strava description formatters — pure helpers ported from
 * sync/src/strava_description.py. Used when finalizing a Strava activity.
 * (compute_prs + generate_description are DB-backed and live in the orchestrator.)
 */

/** Python round(x, 1): decimal-correct rounding to one place. */
function round1(x: number): number { return Number(x.toFixed(1)); }
/** Python round(x): round-half-to-even, only on an exact .5. */
function pyRound(x: number): number {
  const f = Math.floor(x), d = x - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

/** Format weight in kg, rounding neatly. 0 → "BW". */
export function formatWeight(kg: number): string {
  if (kg === 0) return "BW";
  const rounded = round1(kg);
  return rounded === Math.trunc(rounded) ? `${Math.trunc(rounded)}kg` : `${rounded}kg`;
}

/** Format duration as "Xh Ym" (or "Ym" under an hour). */
export function formatDuration(seconds: number): string {
  const minutes = Math.trunc(seconds / 60);
  if (minutes >= 60) {
    const h = Math.trunc(minutes / 60), m = minutes % 60;
    return `${h}h ${m}m`;
  }
  return `${minutes}m`;
}

export interface ExerciseLike { sets?: unknown[] }

/** Average HR per exercise, split proportionally by set count. Null when no data. */
export function sliceHrByExercise(hrSamples: number[], exercises: ExerciseLike[]): (number | null)[] {
  if (!hrSamples.length || !exercises.length) return exercises.map(() => null);
  const totalSets = exercises.reduce((s, ex) => s + (ex.sets?.length ?? 0), 0);
  if (totalSets === 0) return exercises.map(() => null);

  const result: (number | null)[] = [];
  let offset = 0;
  const n = hrSamples.length;
  for (const ex of exercises) {
    const exSets = ex.sets?.length ?? 0;
    const sliceSize = Math.max(1, Math.trunc((n * exSets) / totalSets));
    const end = Math.min(offset + sliceSize, n);
    const chunk = hrSamples.slice(offset, end);
    result.push(chunk.length ? pyRound(chunk.reduce((a, b) => a + b, 0) / chunk.length) : null);
    offset = end;
  }
  return result;
}
