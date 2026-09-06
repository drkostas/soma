export const RANGES = [
  { label: "1W", value: "1w", days: 7 },
  { label: "2W", value: "2w", days: 14 },
  { label: "1M", value: "1m", days: 30 },
  { label: "3M", value: "3m", days: 90 },
  { label: "6M", value: "6m", days: 180 },
  { label: "9M", value: "9m", days: 270 },
  { label: "1Y", value: "1y", days: 365 },
  { label: "2Y", value: "2y", days: 730 },
  { label: "3Y", value: "3y", days: 1095 },
  { label: "All", value: "all", days: 3650 },
] as const;

export function rangeToDays(range: string | undefined): number {
  if (!range) return 180; // default 6 months
  const found = RANGES.find((r) => r.value === range);
  return found ? found.days : 180;
}

/**
 * Days for a range key coming from either client. The web sends the RANGES
 * keys (1w … all); the app's JSON routes historically accepted "7d/14d/90d/1y"
 * and silently fell back to 30 days for anything else, which turned the app's
 * default 6M into a 30-day window (#743). Accept both shapes.
 */
export function parseRangeDays(range: string | null | undefined, fallbackDays = 180): number {
  if (!range) return fallbackDays;
  const m = /^(\d+)d$/.exec(range);
  if (m) return Number(m[1]);
  const found = RANGES.find((r) => r.value === range);
  return found ? found.days : fallbackDays;
}
