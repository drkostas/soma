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

/**
 * How far back Health Connect lets an app read WITHOUT `READ_HEALTH_DATA_HISTORY`.
 *
 * From Android's documentation: "By default, all applications can read data from Health Connect for
 * up to 30 days prior to when any permission was first granted", and without the history permission
 * "an attempt to read records older than 30 days results in an error". The error is the dangerous
 * part, because it fails the WHOLE read, not just the old records in it.
 */
export const RECENT_WINDOW_DAYS = 30;

/** "full" asks for everything since `HISTORY_ORIGIN`; "recent" for the last 30 days. */
export type WindowSpan = "full" | "recent";

/** The window to ask Health Connect for. The whole history, unless told to read only the recent part. */
export function historyWindow(
  now: Date = new Date(),
  span: WindowSpan = "full",
): { startTime: string; endTime: string } {
  const start = span === "full"
    ? HISTORY_ORIGIN
    : new Date(now.getTime() - RECENT_WINDOW_DAYS * 86_400_000).toISOString();
  return { startTime: start, endTime: now.toISOString() };
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

/**
 * Read the whole history, and if Health Connect refuses that, read the last 30 days instead.
 *
 * ⛔ WHY BY BEHAVIOUR AND NOT BY CHECKING THE GRANT. `react-native-health-connect` 4.1.3 reports
 * background access back to JavaScript but never reports `READ_HEALTH_DATA_HISTORY`, even when it is
 * granted. So "is history allowed? then read everything" would always answer no and the backlog would
 * never be read. Asking for everything and falling back when refused works whatever the library says.
 *
 * ⚠️ `span: "full"` means the full range was asked for and not refused. It does not prove the old
 * records came back, because Health Connect may also trim silently. The proof of the backlog is the
 * oldest date that reaches soma, which is checked on the server.
 */
export async function readWithFallback<T>(
  read: (window: { startTime: string; endTime: string }) => Promise<T>,
  now: Date = new Date(),
): Promise<{ value: T; span: WindowSpan; fullError?: string }> {
  try {
    return { value: await read(historyWindow(now, "full")), span: "full" };
  } catch (e) {
    const fullError = (e as Error)?.message?.slice(0, 200) ?? String(e);
    // If this one throws too, let it. Its message is the real reason nothing could be read.
    const value = await read(historyWindow(now, "recent"));
    return { value, span: "recent", fullError };
  }
}

/**
 * The most pages one read will follow. 50 pages of 1000 is 50,000 weigh-ins, which is well over a
 * century of daily weighing, so this only ever bites on a page token that never ends.
 */
export const MAX_PAGES = 50;

/**
 * Every record across every page, not just the first 1000.
 *
 * ⛔ `readRecords` returns one page (1000 by default) plus a `pageToken` when there is more, and a
 * single call silently drops the rest. For years of weigh-ins read oldest first, what it drops is the
 * history, which is the whole requirement.
 */
export async function readAllPages<T>(
  readPage: (pageToken: string | undefined) => Promise<{ records?: T[]; pageToken?: string }>,
): Promise<T[]> {
  const all: T[] = [];
  let token: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const r = await readPage(token);
    all.push(...(r.records ?? []));
    if (!r.pageToken) break;
    token = r.pageToken;
  }
  return all;
}

/** Which permission request the app should make next. */
export type AskStep = "data" | "extras" | "none";

/**
 * What to ask for next, given what Health Connect has granted.
 *
 * ⛔ TWO STEPS, NOT ONE. On his phone a single request for all four granted Weight and BodyFat and
 * left history and background false, with no follow-up screen, even though he chose "Allow all".
 * Android's own examples ask for background and history as a request of their own, after a data
 * permission exists. So the data types come first and the extras second.
 *
 * History cannot be part of this decision: `react-native-health-connect` 4.1.3 never reports it back.
 * It rides along with the background request instead, which the library does report.
 */
export function nextAsk(granted: { weight: boolean; background: boolean }): AskStep {
  if (!granted.weight) return "data";
  if (!granted.background) return "extras";
  return "none";
}
