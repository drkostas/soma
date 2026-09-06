/**
 * Logging coverage for a nutrition day — how much of the day was actually
 * observed, as opposed to assumed.
 *
 * A day has four slots. A slot is COVERED when the user either logged food
 * with calories in it, or explicitly skipped it (skip-slot is the "I did not
 * eat this" assertion, which is real information). A slot that is neither is
 * ABSENT: not zero, unknown. Treating absent as zero is how a breakfast-only
 * day turns into a fake 600-kcal "intake" and poisons the adaptive TDEE.
 *
 * The floor is calibrated from the user's own history, not guessed: during the
 * Mar–Apr 2026 active period, 33 of 48 closed days covered 3+ of 4 slots
 * (#698). Below the floor a closed day is treated exactly like an unclosed
 * one: it contributes nothing, and it does not pretend to.
 */

export const ALL_SLOTS = ["breakfast", "lunch", "dinner", "pre_sleep"] as const;
export type Slot = (typeof ALL_SLOTS)[number];

/** Minimum coverage for a closed day to feed any inference. 3 of 4 slots. */
export const COVERAGE_FLOOR = 0.75;

/**
 * Max gap, in days, between two counted days before a "consecutive" deficit
 * streak is considered broken. Without this, a streak walks straight across
 * months of absent data and reports last spring's deficit as the current phase.
 */
export const STREAK_MAX_GAP_DAYS = 7;

/**
 * Fraction of the four slots that were covered. Slots outside ALL_SLOTS (for
 * example "during_workout") are ignored rather than inflating the count, and
 * a slot that is both logged and skipped counts once.
 */
export function slotCoverage(
  loggedSlots: readonly string[] | null | undefined,
  skippedSlots: readonly string[] | null | undefined,
): number {
  const covered = new Set<string>();
  for (const s of loggedSlots ?? []) if ((ALL_SLOTS as readonly string[]).includes(s)) covered.add(s);
  for (const s of skippedSlots ?? []) if ((ALL_SLOTS as readonly string[]).includes(s)) covered.add(s);
  return covered.size / ALL_SLOTS.length;
}

/** True when a day's coverage clears the floor. `null` coverage is unknown → false. */
export function meetsCoverageFloor(coverage: number | null | undefined): boolean {
  return typeof coverage === "number" && Number.isFinite(coverage) && coverage >= COVERAGE_FLOOR;
}

/** Whole days between two ISO dates (b − a). Both are date-only strings. */
export function daysBetween(a: string, b: string): number {
  const ms = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) -
    Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10));
  return Math.round(ms / 86_400_000);
}
