/**
 * What did the user eat on a trend-row day? (#717)
 *
 * `nutrition_day.actual_calories` is written only when the day is closed.
 * Before that it is 0, so an open past day with real meals logged rendered
 * "ate –" while its coverage said something was there (2026-09-01: one meal,
 * 465 kcal, actual_calories 0).
 *
 * Rule, one branch per source of truth:
 * - today          → the live `consumed` total the hero already shows
 * - closed day     → `actual_calories`, which close-day reconciled
 * - open past day  → the sum of what was logged (meal_log + drink_log)
 *
 * The `counted` flag and the coverage floor (#699) are untouched: an open day
 * still never feeds the weekly total; it just stops lying about its own row.
 */
export interface TrendAteInput {
  isToday: boolean;
  closed: boolean;
  /** nutrition_day.actual_calories */
  actualCalories: number | null | undefined;
  /** SUM(meal_log.calories) + SUM(drink_log.calories) for that date */
  loggedCalories: number | null | undefined;
  /** the live consumed total for today */
  todayConsumed: number;
}

export function trendAte(i: TrendAteInput): number {
  if (i.isToday) return i.todayConsumed;
  if (i.closed) return Number(i.actualCalories) || 0;
  return Number(i.loggedCalories) || 0;
}
