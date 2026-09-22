/**
 * Which number a burn row shows, kept out of the screen so it can be tested.
 *
 * ⛔ THE BUG THIS EXISTS FOR. `runActual` is a FLAG, true when the run really happened, and the
 * calories are in `runCalories`. The screen passed the flag where the figure belonged, and a
 * 222 kcal run rendered as "1 kcal", because `Number(true)` is 1 and the app's own type declared
 * the field a number. TypeScript could not help while the type agreed with the mistake.
 */
export interface RunBurn {
  runCalories?: number;
  runPredicted?: number;
  /** A flag, not a figure. */
  runActual?: boolean;
}

/** The calories to show for the run: what he did, or what was planned, or nothing yet. */
export function runKcal(bd: RunBurn | null | undefined): number {
  const n = bd?.runCalories ?? bd?.runPredicted ?? 0;
  // A flag arriving here from an older build, or a string from a hand-edited response, is not a
  // calorie count. Anything that is not a finite number is nothing.
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/** Whether to say the run is planned rather than done. */
export function runIsPlanned(bd: RunBurn | null | undefined): boolean {
  return !bd?.runActual;
}

/**
 * The "~N kcal predicted" aside, which is only worth saying when there was a prediction AND it
 * differs from what he actually did.
 */
export function runPredictionNote(bd: RunBurn | null | undefined): string | null {
  const predicted = bd?.runPredicted ?? 0;
  if (!bd?.runActual || predicted <= 0) return null;
  if (predicted === bd?.runCalories) return null;
  return `~${Math.round(predicted)} kcal predicted`;
}
