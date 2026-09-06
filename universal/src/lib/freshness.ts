/**
 * Is an observed recovery value still current? Twin of web/lib/freshness.ts
 * (#731): a night, HRV, SpO2 or body-battery reading is current for two days
 * after the date it describes; older is stale and reads as unknown, never as
 * the last value we saw.
 */
export const RECOVERY_MAX_AGE_DAYS = 2;

export interface Freshness {
  observed: string | null;
  ageDays: number | null;
  missing: boolean;
  stale: boolean;
}

function dayMs(d: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function freshness(observed: string | null | undefined, today: string, maxAgeDays: number = RECOVERY_MAX_AGE_DAYS): Freshness {
  if (!observed) return { observed: null, ageDays: null, missing: true, stale: true };
  const a = dayMs(observed);
  const b = dayMs(today);
  if (Number.isNaN(a) || Number.isNaN(b)) return { observed: observed.slice(0, 10), ageDays: null, missing: false, stale: true };
  const ageDays = Math.round((b - a) / 86_400_000);
  return { observed: observed.slice(0, 10), ageDays, missing: false, stale: ageDays > maxAgeDays };
}

/** Short phone copy: "no night since 08-23", "no HRV since 08-21", "no night yet". */
export function staleShort(noun: "night" | "HRV" | "SpO2" | "body battery", f: Freshness): string {
  return f.observed ? `no ${noun} since ${f.observed.slice(5)}` : `no ${noun} yet`;
}

/** Today's date in soma's day boundary (New York), YYYY-MM-DD. */
export function todayKey(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}
