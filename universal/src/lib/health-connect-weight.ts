/**
 * Turning Health Connect records into weigh-ins soma can store.
 *
 * ⛔ THERE IS NO WATERMARK, ON PURPOSE. He asked for the full history: "Make sure it can read
 * backlog from arboleaf. Its imorotmant we pull the full hisotry". So every run reads from a fixed
 * origin rather than "since last time". A watermark would be faster and would permanently miss
 * anything Arboleaf backfills with an old date, which is exactly the case that matters here, since
 * a month of weigh-ins already exists inside its app and has never left.
 *
 * Re-reading everything is only safe because the server is idempotent on Health Connect's own
 * record id. The two halves are designed together: the phone forgets nothing because it remembers
 * nothing.
 */

/** Far enough back to predate any scale he has owned. Weight records are tiny and few. */
export const HISTORY_ORIGIN = "2015-01-01T00:00:00.000Z";

/** Health Connect stores weight and body fat as SEPARATE records, even from one step on the scale. */
export interface HcWeightRecord {
  metadata?: { id?: string; dataOrigin?: string };
  time?: string;
  weight?: { inKilograms?: number };
}
export interface HcBodyFatRecord {
  time?: string;
  percentage?: number;
}

export interface WeightReading {
  externalId: string | null;
  at: string;
  weightKg: number;
  bodyFatPct: number | null;
  source: string;
}

/** The window to ask Health Connect for. Always the whole history. */
export function historyWindow(now: Date = new Date()): { startTime: string; endTime: string } {
  return { startTime: HISTORY_ORIGIN, endTime: now.toISOString() };
}

/**
 * How close a body-fat record has to be to count as the same weigh-in.
 *
 * One step on the scale writes both within a second or two, but a scale that computes composition
 * after the weight can lag. Five minutes is generous and still cannot collide with a second
 * weigh-in, because nobody weighs twice inside five minutes.
 */
export const PAIR_WINDOW_MS = 5 * 60 * 1000;

/**
 * Pair each weight with the body fat measured at the same moment, and drop anything unusable.
 *
 * A weight with no readable number is skipped rather than sent as a zero: the server would refuse
 * it anyway, and a refusal per run for ever is noise that hides a real one.
 */
export function toReadings(
  weights: HcWeightRecord[],
  bodyFats: HcBodyFatRecord[] = [],
): WeightReading[] {
  const fats = bodyFats
    .map((f) => ({ t: Date.parse(f.time ?? ""), pct: f.percentage }))
    .filter((f) => Number.isFinite(f.t) && typeof f.pct === "number");

  const out: WeightReading[] = [];
  for (const w of weights) {
    const kg = w.weight?.inKilograms;
    const t = Date.parse(w.time ?? "");
    if (typeof kg !== "number" || !Number.isFinite(kg) || !Number.isFinite(t)) continue;

    let nearest: { pct: number; gap: number } | null = null;
    for (const f of fats) {
      const gap = Math.abs(f.t - t);
      if (gap > PAIR_WINDOW_MS) continue;
      if (!nearest || gap < nearest.gap) nearest = { pct: f.pct as number, gap };
    }

    out.push({
      externalId: w.metadata?.id ?? null,
      at: new Date(t).toISOString(),
      weightKg: kg,
      bodyFatPct: nearest ? nearest.pct : null,
      source: "HEALTH_CONNECT",
    });
  }
  // Oldest first, so a partial send still walks the history forwards.
  return out.sort((a, b) => a.at.localeCompare(b.at));
}
