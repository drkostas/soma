/** Energy reconciliation between weigh-ins (soma#891). Kostas's rule: a day is observed only when a
 *  person closed it or every slot was logged; everything else is extrapolated. Between two
 *  weigh-ins the weight change fixes the interval's total energy balance; observed days contribute
 *  what was logged; one intake rate A closes the interval: an unlogged day eats A, a partly logged
 *  day eats its logged kcal plus A times the share of the day it did not log. Days before the
 *  first or after the last weigh-in borrow the nearest interval's A. With fewer than two weigh-ins
 *  nothing is solved and every day is unknown. */
export const KCAL_PER_KG = 7700; // the constant body-comp already uses

export interface DayIn {
  date: string;
  /** hand-closed or fully logged: ate is what was logged, nothing is filled */
  observed: boolean;
  loggedKcal: number;
  /** share of the day's budget covered by logged or skipped slots, 0..1 */
  loggedShare: number;
  burn: number;
}

export type DaySource = "observed" | "partial" | "extrapolated" | "unknown";

export interface DayOut {
  date: string;
  ate: number;
  burn: number;
  /** ate minus burn: negative is a deficit */
  deficit: number;
  source: DaySource;
  intervalStart: string | null;
  intervalEnd: string | null;
}

export function reconcile(weighIns: { date: string; weightKg: number }[], days: DayIn[]): DayOut[] {
  const w = [...weighIns].filter((x) => x.weightKg > 0).sort((a, b) => a.date.localeCompare(b.date));
  const unknown = (d: DayIn): DayOut => ({
    date: d.date, ate: d.loggedKcal, burn: d.burn, deficit: d.loggedKcal - d.burn, source: "unknown", intervalStart: null, intervalEnd: null,
  });
  if (w.length < 2) return days.map(unknown);

  const out = new Map<string, DayOut>();
  const rates: { start: string; end: string; A: number }[] = [];
  for (let i = 0; i + 1 < w.length; i++) {
    const start = w[i].date, end = w[i + 1].date;
    const inRange = days.filter((d) => d.date >= start && d.date < end);
    const implied = (w[i + 1].weightKg - w[i].weightKg) * KCAL_PER_KG;
    let known = 0, unknownShare = 0, partialFixed = 0;
    for (const d of inRange) {
      if (d.observed) known += d.loggedKcal - d.burn;
      else { unknownShare += Math.max(0, 1 - d.loggedShare); partialFixed += d.loggedKcal - d.burn; }
    }
    const A = unknownShare > 0 ? (implied - known - partialFixed) / unknownShare : 0;
    rates.push({ start, end, A });
    for (const d of inRange) out.set(d.date, fill(d, A, start, end));
  }
  for (const d of days) {
    if (out.has(d.date)) continue;
    const r = d.date < rates[0].start ? rates[0] : rates[rates.length - 1];
    out.set(d.date, fill(d, r.A, r.start, r.end));
  }
  return days.map((d) => out.get(d.date)!);
}

function fill(d: DayIn, A: number, start: string, end: string): DayOut {
  if (d.observed) {
    return { date: d.date, ate: d.loggedKcal, burn: d.burn, deficit: d.loggedKcal - d.burn, source: "observed", intervalStart: start, intervalEnd: end };
  }
  const ate = d.loggedKcal + A * Math.max(0, 1 - d.loggedShare);
  return { date: d.date, ate, burn: d.burn, deficit: ate - d.burn, source: d.loggedShare > 0 ? "partial" : "extrapolated", intervalStart: start, intervalEnd: end };
}
