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

/**
 * ⛔ PACKAGES SOMA PUSHES WEIGHT TO, WHOSE OWN RECORDS MUST NEVER BE READ BACK AS SOURCE READINGS.
 *
 * Garmin Connect declares WRITE_WEIGHT and WRITE_BODY_FAT to Health Connect and no reads at all
 * (verified from `dumpsys package`, 13 health permissions, every one a write). So the moment that
 * write is granted, a weigh-in soma pushed to Garmin comes back into Health Connect as a NEW record
 * with a NEW id, soma reads it as a fresh reading, stores it, and pushes it to Garmin again.
 *
 * That is the same defect that already cost this project 13.5% of its 90-day training load, arriving
 * one layer down. It is currently latent only because Garmin's write is not granted, which is one
 * toggle away from being granted.
 *
 * `weight_log`'s existing `UNIQUE (date, weight_grams)` is the backstop and it caught this in a live
 * probe, answering `already` to Garmin's copy of the same weigh-in. It is a backstop rather than the
 * guard because it only holds while the grams match to the last gram, and a float round trip through
 * Garmin need not preserve that.
 */
export const FEEDBACK_ORIGINS: readonly string[] = [
  "com.garmin.android.apps.connectmobile",
];

/** Whether this record came from something soma feeds, rather than from a scale. */
export function isFeedback(origin: string | undefined | null): boolean {
  return typeof origin === "string" && FEEDBACK_ORIGINS.includes(origin);
}

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
  /** Which app wrote the record, so the server can see where a reading came from. */
  origin: string | null;
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
    // An unknown origin is KEPT. If a library version stops populating it, dropping those would
    // silently sync nothing, which is worse than the loop this guards, and the loop still has the
    // unique key behind it.
    if (isFeedback(w.metadata?.dataOrigin)) continue;
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
      origin: w.metadata?.dataOrigin ?? null,
      at: new Date(t).toISOString(),
      weightKg: kg,
      bodyFatPct: nearest ? nearest.pct : null,
      source: "HEALTH_CONNECT",
    });
  }
  // Oldest first, so a partial send still walks the history forwards.
  return out.sort((a, b) => a.at.localeCompare(b.at));
}
