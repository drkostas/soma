/**
 * Which weigh-ins are him, and which are a typo.
 *
 * He enters weigh-ins on Garmin by hand from the gym scale, often, and those are real
 * measurements: "If i manually entered weights on garmin( i did many times in the spring) those are
 * real wrigh ins at the gym. And i may do it sometimes. But if you have a Manual wirgh in that looks
 * like a mn outlier then discard it" (2026-09-25).
 *
 * ⛔ SO THE TEST IS PLAUSIBILITY, NEVER PROVENANCE. A hand-entered weigh-in is not suspect for being
 * hand-entered. It is suspect only when the number cannot be him.
 *
 * ## Where the threshold comes from
 *
 * Measured against his own 140 hand-entered weigh-ins rather than chosen. Deviation from the median
 * of the weigh-ins within a fortnight either side:
 *
 *     n=136   median 0.35   p90 1.00   p99 2.07   max 2.15 kg
 *
 * And consecutive weigh-ins one to three days apart, which is the fastest real change:
 *
 *     n=101   median 0.30   p90 1.20   p99 2.00   max 2.40 kg
 *
 * His whole recorded range is 73.2 to 80.5 kg over four years. So **no real weigh-in of his has ever
 * sat more than 2.15 kg from its neighbours**, and 3 kg leaves half a kilo of headroom above that
 * while still catching every shape of typo that matters: a transposed digit (73.2 as 37.2), a stray
 * one (83.2), pounds entered as kilograms (161), a dropped decimal point (732).
 *
 * The bounds in `weight-reading.ts` are a different job. They refuse 8 kg and 300 kg at the door,
 * which is a reading that cannot be any human. This refuses a reading that cannot be HIM, and it
 * needs his history to say so, which is why it lives here and runs later.
 */

/** One weigh-in, as the trend reads it. */
export interface WeighIn {
  date: string;
  weightKg: number;
  /** Carried through when the caller needs it. The detector judges the weight only. */
  bodyFatPct?: number | null;
}

/** A weigh-in the detector rejected, with what it expected instead. */
export interface Discarded extends WeighIn {
  localMedianKg: number;
  offByKg: number;
}

/**
 * How far from its neighbours a weigh-in may sit before it is a typo rather than him.
 *
 * 3 kg, against a measured maximum of 2.15. Widening this admits typos; narrowing it starts
 * discarding real weigh-ins, and discarding a real one is worse, because the trend then reads a
 * change that did not happen.
 */
export const OUTLIER_KG = 3.0;

/** A fortnight either side. Long enough to hold several weigh-ins, short enough to track a cut. */
export const LOCAL_WINDOW_DAYS = 14;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const DAY_MS = 86_400_000;

/**
 * The median of the OTHER weigh-ins near this one, or null when it has no neighbours.
 *
 * It excludes the weigh-in itself on purpose. Including it drags the median towards the very value
 * being judged, so a lone bad reading partly excuses itself.
 */
export function localMedian(
  rows: readonly WeighIn[],
  index: number,
  windowDays = LOCAL_WINDOW_DAYS,
): number | null {
  const at = Date.parse(rows[index].date);
  if (!Number.isFinite(at)) return null;
  const near: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (i === index) continue;
    const t = Date.parse(rows[i].date);
    if (!Number.isFinite(t)) continue;
    if (Math.abs(t - at) <= windowDays * DAY_MS) near.push(rows[i].weightKg);
  }
  return near.length ? median(near) : null;
}

/**
 * Split weigh-ins into the ones to trust and the ones to discard.
 *
 * A weigh-in with no neighbours is KEPT. There is nothing to judge it against, and throwing away the
 * only reading in a fortnight because it stands alone would quietly empty a sparse stretch of the
 * history, which is most of his last four months.
 */
export function flagOutliers(
  rows: readonly WeighIn[],
  thresholdKg = OUTLIER_KG,
  windowDays = LOCAL_WINDOW_DAYS,
): { kept: WeighIn[]; discarded: Discarded[] } {
  const kept: WeighIn[] = [];
  const discarded: Discarded[] = [];
  for (let i = 0; i < rows.length; i++) {
    const med = localMedian(rows, i, windowDays);
    const offBy = med === null ? 0 : Math.abs(rows[i].weightKg - med);
    if (med !== null && offBy > thresholdKg) {
      discarded.push({ ...rows[i], localMedianKg: med, offByKg: Math.round(offBy * 100) / 100 });
    } else {
      kept.push(rows[i]);
    }
  }
  return { kept, discarded };
}
