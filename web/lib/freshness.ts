/**
 * Is an observed value still "current"? (#731, the #698 principle applied to
 * recovery data: absent is unknown, not the last thing we saw.)
 *
 * The watch stopped recording nights on 2026-08-23 and two weeks later the
 * pages still said "Last Night · 3h43m", "HRV last night 76 ms", "SpO2 last
 * night 92%". Every headline that claims recency now carries the date it was
 * observed and demotes itself once that date is older than the source's
 * cadence allows.
 *
 * One rule for all recovery signals: a night, HRV, SpO2 or body-battery
 * reading is current for RECOVERY_MAX_AGE_DAYS after the date it describes.
 * Two days, not one, so a sync that lands a night late is not shouted about.
 */
export const RECOVERY_MAX_AGE_DAYS = 2;

export interface Freshness {
  /** YYYY-MM-DD the value describes, or null when nothing was ever observed. */
  observed: string | null;
  /** Whole days between observed and today (0 = today). null when missing. */
  ageDays: number | null;
  /** True when there is no observation at all. */
  missing: boolean;
  /** True when observed is older than maxAgeDays (also true when missing). */
  stale: boolean;
}

/** YYYY-MM-DD → UTC midnight ms; tolerates timestamps by taking the date part. */
function dayMs(d: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function freshness(
  observed: string | null | undefined,
  today: string,
  maxAgeDays: number = RECOVERY_MAX_AGE_DAYS,
): Freshness {
  if (!observed) return { observed: null, ageDays: null, missing: true, stale: true };
  const a = dayMs(observed);
  const b = dayMs(today);
  if (Number.isNaN(a) || Number.isNaN(b)) return { observed: observed.slice(0, 10), ageDays: null, missing: false, stale: true };
  const ageDays = Math.round((b - a) / 86_400_000);
  return { observed: observed.slice(0, 10), ageDays, missing: false, stale: ageDays > maxAgeDays };
}

/** "No night recorded since 2026-08-23", "No HRV reading since …", or "No night recorded yet". */
export function staleHeadline(noun: "night" | "HRV reading" | "SpO2 reading" | "body battery reading", f: Freshness): string {
  const what = noun === "night" ? "No night recorded" : `No ${noun}`;
  return f.observed ? `${what} since ${f.observed}` : `${what} yet`;
}

/** Today's date in the user's day boundary (New York, like the rest of soma), YYYY-MM-DD. */
export function todayKey(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}
