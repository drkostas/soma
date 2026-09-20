/**
 * Is this anything like a meal he eats?
 *
 * The agent says what the foods are. This module has no opinion about that. Its only job is to
 * notice when the GRAMS we guessed produce a meal unlike anything in his log, and to pull the
 * guesses back until it is plausible.
 *
 * ⛔ IT ONLY EVER SHRINKS AMOUNTS NOBODY STATED. A weighed 1,200 kcal dinner is a real dinner and
 * is left exactly alone, however unusual. The failure this exists for is the opposite case: on
 * 2026-09-20 a breakfast was logged at 4,129 kcal, 16 standard deviations above his breakfast mean
 * and 43% more than his largest recorded day, entirely from two amounts he never gave.
 *
 * The numbers come from his own `meal_log`, so they move with him. Nothing here is a constant
 * about people.
 */
import type { QueryFn } from "./db";
import type { ResolvedItem, WeighMethod } from "./meal-quantity";

/** What his log says about one slot. */
export interface SlotStats { n: number; mean: number; sd: number; max: number }
export interface HistoryStats { slots: Map<string, SlotStats>; day: SlotStats }

/**
 * Below this many meals in a slot the mean and the spread are not worth trusting, so a flat
 * ceiling stands in. Twelve is a fortnight of that slot.
 */
export const MIN_MEALS = 12;
/** The ceiling when there is not enough history to compute one. Generous on purpose. */
export const FALLBACK_SLOT_KCAL = 1200;
export const FALLBACK_DAY_KCAL = 3000;

/**
 * ⛔ THE DAY BEING OVER ALREADY IS NOT A REASON TO ERASE A MEAL HE ATE.
 *
 * The day headroom can be zero or negative, and on 2026-09-20 it was: the day already held the
 * 4,129 kcal meal being replaced, so the headroom came out at -1,115, the ceiling at 0, and every
 * item was scaled to one gram and nought calories. That is worse than the bug it was added to
 * fix, because it silently deletes food rather than exaggerating it.
 *
 * So the day can only ever pull a meal down to this fraction of its own slot ceiling, never past
 * it. Below that the day's total is somebody else's problem to look at, not this function's to
 * solve by making the food disappear.
 */
export const MIN_SHARE_OF_SLOT = 0.5;

/**
 * How far over the ceiling a meal has to be before this does anything.
 *
 * Without it the guard trims a 30 kcal guess by 13 and announces that the meal was "more than you
 * ever eat", which is both untrue at that scale and noise. It exists to catch the breakfast that
 * came to 4,129, not to arbitrate the last biscuit.
 */
export const MIN_OVERSHOOT_KCAL = 120;

/**
 * How far above the mean a meal may sit before the guessed part is pulled back.
 * Three at the slot level, because one meal is allowed to be an outlier. Two at the day level,
 * because a day of outliers is not a day he has ever had.
 */
export const SLOT_SIGMA = 3;
export const DAY_SIGMA = 2;

/** The weigh methods that mean every amount in the meal came from him. */
const STATED: ReadonlySet<WeighMethod> = new Set<WeighMethod>(["weighed", "counted", "portion_words", "total_split", "bites"]);

/**
 * True when every amount in this meal came from him rather than from a fit.
 *
 * ⚠️ Kept because it is still the cheap early exit, but it is NOT what decides which items may be
 * scaled. `mixed` means some amounts were given and some were not, and deciding per meal scaled a
 * weighed 200 g of chicken down to 81 g because a guess about nuts was wrong. Per item, below.
 */
export function amountsWereStated(method: WeighMethod): boolean {
  return STATED.has(method);
}

/**
 * The most this meal may come to. `max(mean + k·sd, the largest he has actually eaten)`, because a
 * record-breaking meal is a thing that happens and should not be clamped for being a record.
 */
export function slotCeiling(stats: HistoryStats, slot: string): number {
  const s = stats.slots.get(slot);
  if (!s || s.n < MIN_MEALS) return FALLBACK_SLOT_KCAL;
  return Math.max(s.mean + SLOT_SIGMA * s.sd, s.max);
}

/** The most the whole day may come to, on the same reasoning. */
export function dayCeiling(stats: HistoryStats): number {
  const d = stats.day;
  if (!d || d.n < MIN_MEALS) return FALLBACK_DAY_KCAL;
  return Math.max(d.mean + DAY_SIGMA * d.sd, d.max);
}

export interface PlausibilityInput {
  items: ResolvedItem[];
  weighMethod: WeighMethod;
  slot: string;
  /** What the day already holds, so "based on the day so far" is honoured. */
  consumedToday: number;
  stats: HistoryStats;
}

export interface PlausibilityResult {
  items: ResolvedItem[];
  /** Set when something was pulled back, and phrased for the summary the owner reads. */
  note: string | null;
  before: number;
  after: number;
}

const kcal = (items: ResolvedItem[]) => items.reduce((s, i) => s + i.calories, 0);

/**
 * Pull the guessed amounts back until the meal is plausible, and say so when it happens.
 *
 * Returns the items unchanged and `note: null` in the ordinary case, which is almost always.
 */
export function enforcePlausibility(input: PlausibilityInput): PlausibilityResult {
  const { items, weighMethod, slot, consumedToday, stats } = input;
  const before = Math.round(kcal(items));

  // He gave the amounts. Nothing here is entitled to second-guess them.
  if (amountsWereStated(weighMethod)) return { items, note: null, before, after: before };

  const bySlot = slotCeiling(stats, slot);
  const headroom = dayCeiling(stats) - Math.max(0, consumedToday);
  // The day may tighten the slot's ceiling, but never below half of it. See MIN_SHARE_OF_SLOT.
  const floor = bySlot * MIN_SHARE_OF_SLOT;
  const ceiling = Math.max(floor, Math.min(bySlot, headroom));
  // Over the ceiling, but not by enough to be worth touching or mentioning.
  if (before <= ceiling + MIN_OVERSHOOT_KCAL || before <= 0) {
    return { items, note: null, before, after: before };
  }

  // ⛔ ONLY THE GUESSES MAY BE SCALED. An amount he gave is a fact about his morning; a fitted
  // amount is this program's opinion, and an opinion is what gets corrected. Deciding per meal
  // scaled a weighed 200 g of chicken to 81 g because a guess about nuts was wrong.
  const statedKcal = items.filter((i) => i.stated).reduce((s, i) => s + i.calories, 0);
  const guessedKcal = before - statedKcal;
  // What the guesses are allowed to come to. Never negative: if what he stated already exceeds the
  // ceiling then the meal is his, not ours, and there is nothing here to correct.
  const roomForGuesses = ceiling - statedKcal;
  if (guessedKcal <= 0 || roomForGuesses >= guessedKcal) {
    return { items, note: null, before, after: before };
  }
  const factor = Math.max(0, roomForGuesses) / guessedKcal;
  const scaled = items.map((i) => (i.stated ? i : {
    ...i,
    grams: Math.max(1, Math.round(i.grams * factor)),
    calories: Math.round(i.calories * factor),
    protein: Math.round(i.protein * factor * 10) / 10,
    carbs: Math.round(i.carbs * factor * 10) / 10,
    fat: Math.round(i.fat * factor * 10) / 10,
    fiber: Math.round(i.fiber * factor * 10) / 10,
  }));
  const after = Math.round(kcal(scaled));
  const limiter = ceiling < bySlot ? "day" : slot.replace(/_/g, " ");
  // "the amounts" would be a lie when he gave some of them, and the whole point of this change is
  // that those are left alone.
  const whose = statedKcal > 0 ? "some of the amounts" : "the amounts";
  return {
    items: scaled,
    note: `I had to guess ${whose}, and my first guess came to ${before} kcal, which is more than you ever eat. Brought it down to ${after} to fit your usual ${limiter}. Say the weights if that is wrong.`,
    before,
    after,
  };
}

/** His own distribution, from his own log. 180 days, which is long enough to be stable. */
export async function getHistoryStats(sql: QueryFn): Promise<HistoryStats> {
  const rows = (await sql`
    WITH m AS (
      SELECT meal_slot, calories FROM meal_log
      WHERE date >= CURRENT_DATE - INTERVAL '180 days' AND calories > 0
    )
    SELECT meal_slot, count(*)::int AS n, avg(calories) AS mean,
           coalesce(stddev_samp(calories), 0) AS sd, max(calories) AS max
    FROM m GROUP BY meal_slot`) as Array<{ meal_slot: string; n: number; mean: number; sd: number; max: number }>;

  const dayRows = (await sql`
    WITH d AS (
      SELECT date, sum(calories) AS kcal FROM meal_log
      WHERE date >= CURRENT_DATE - INTERVAL '180 days' GROUP BY date HAVING sum(calories) > 0
    )
    SELECT count(*)::int AS n, avg(kcal) AS mean, coalesce(stddev_samp(kcal), 0) AS sd, max(kcal) AS max
    FROM d`) as Array<{ n: number; mean: number; sd: number; max: number }>;

  const slots = new Map<string, SlotStats>();
  for (const r of rows) {
    slots.set(String(r.meal_slot), {
      n: Number(r.n), mean: Number(r.mean), sd: Number(r.sd), max: Number(r.max),
    });
  }
  const d = dayRows[0];
  return {
    slots,
    day: d ? { n: Number(d.n), mean: Number(d.mean), sd: Number(d.sd), max: Number(d.max) }
           : { n: 0, mean: 0, sd: 0, max: 0 },
  };
}
