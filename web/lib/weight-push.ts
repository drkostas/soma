/**
 * Sending a weigh-in outwards, to Garmin.
 *
 * He asked for this: "updatinign garmin and strava with hte wieght data is our sync job too". The
 * scale writes to Health Connect, the phone hands it to soma, and soma is then the only thing that
 * knows his weight, so Garmin's own calorie and VO2 maths would keep working off a figure from
 * August unless something tells it.
 */
import type { QueryFn } from "./db";

/**
 * ⛔ EVERY OTHER SOURCE IN `weight_log` BELONGS TO GARMIN, so this list has exactly one entry.
 *
 * `garmin-parse-day.ts` is the ONLY other writer of that table, and all 267 existing rows carry a
 * source Garmin minted: MANUAL 139, INDEX_SCALE 72, MFP 54, USER_SETTING 1. `MANUAL` reads like
 * "someone typed it into soma" and means "he typed it into Garmin".
 *
 * I got this wrong first, with `MANUAL` in the list, and a check script then pushed 29 of his own
 * March-to-May weigh-ins back into Garmin as duplicates beside the originals. Removed by comparing
 * `samplePk` ages. The rule is therefore narrower than "not from Garmin": only what soma itself
 * originates goes out, which today is Health Connect and nothing else.
 */
export const PUSHABLE_SOURCES = ["HEALTH_CONNECT"] as const;

export interface PushableWeight {
  id: number;
  date: string;
  weight_grams: number;
  measured_at: string | null;
}

/** What a Garmin weigh-in POST needs. Kept separate so it can be tested without a client. */
export function garminWeightBody(w: PushableWeight): { dateTimestamp: string; unitKey: string; value: number } {
  // Garmin wants a local-looking timestamp with no zone, and the day is what matters. When we know
  // the instant we use it; otherwise mid-morning, which is when he actually stands on the scale.
  const stamp = w.measured_at
    ? new Date(w.measured_at).toISOString().replace("Z", "").slice(0, 23)
    : `${w.date}T08:00:00.000`;
  return { dateTimestamp: stamp, unitKey: "kg", value: Math.round(w.weight_grams) / 1000 };
}

/** The rows still owed to Garmin. */
export async function weightsOwedToGarmin(sql: QueryFn, limit = 30): Promise<PushableWeight[]> {
  return (await sql`
    SELECT id, date::text AS date, weight_grams, measured_at::text AS measured_at
    FROM weight_log
    WHERE pushed_garmin_at IS NULL
      AND source_type = ANY(${PUSHABLE_SOURCES as unknown as string[]})
    ORDER BY date DESC
    LIMIT ${limit}`) as PushableWeight[];
}

interface WeightClient {
  /** GET. `garmin-auth`'s `connectapi` only reads, which is all the day lookup needs. */
  connectapi<T = unknown>(path: string): Promise<T>;
  post<T = unknown>(path: string, body: unknown): Promise<T>;
}

/** Garmin's own list of weigh-ins for one calendar day. */
export function dayPath(date: string): string {
  return `/weight-service/weight/range/${date}/${date}?includeAll=true`;
}

/** Whether Garmin's answer for a day holds any weigh-in at all, whoever wrote it. */
export function garminHoldsWeighIn(res: unknown): boolean {
  const days = (res as { dailyWeightSummaries?: Array<{ allWeightMetrics?: unknown[] }> })?.dailyWeightSummaries ?? [];
  return days.some((d) => (d.allWeightMetrics ?? []).length > 0);
}

/**
 * Push every owed weigh-in to Garmin, marking each as it goes.
 *
 * Marked one at a time rather than in a batch at the end: a failure halfway through must not
 * re-send the ones that already landed, because Garmin keeps every sample and he would see the same
 * weigh-in several times.
 *
 * ⛔ A DAY GARMIN ALREADY HOLDS IS SKIPPED, NOT GIVEN A SECOND COPY. He reads the scale and types it
 * into Garmin rounded, so on 2025-11-29 Garmin had his 80.00 and soma added the scale's 80.05 beside
 * it. The grams differ, so no equality check here could catch it; asking Garmin about the day can.
 * His entry is the record for that day, and the row is marked settled so it is not asked about again.
 * This gives up a second genuine weigh-in on one day, which Garmin does not need: it keeps a daily
 * weight, and soma still holds both.
 *
 * ⛔ IF GARMIN CANNOT BE ASKED, NOTHING IS PUSHED for that row. A blind push is what caused the
 * duplicates, so the row stays owed and the next run tries again.
 */
export async function pushWeightsToGarmin(
  sql: QueryFn,
  client: WeightClient,
  limit = 30,
): Promise<{ pushed: number; skipped: number; failed: number; errors: string[] }> {
  const owed = await weightsOwedToGarmin(sql, limit);
  let pushed = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const w of owed) {
    let held: boolean;
    try {
      held = garminHoldsWeighIn(await client.connectapi(dayPath(w.date)));
    } catch (e) {
      failed++;
      errors.push(`${w.date} ${(w.weight_grams / 1000).toFixed(1)}kg: could not ask Garmin about the day, not pushed: ${(e as Error).message.slice(0, 100)}`);
      continue;
    }
    if (held) {
      await sql`UPDATE weight_log SET pushed_garmin_at = now() WHERE id = ${w.id}`;
      skipped++;
      continue;
    }
    try {
      await client.post("/weight-service/user-weight", garminWeightBody(w));
      await sql`UPDATE weight_log SET pushed_garmin_at = now() WHERE id = ${w.id}`;
      pushed++;
    } catch (e) {
      failed++;
      // Say which one, so a recurring failure is readable rather than a count.
      errors.push(`${w.date} ${(w.weight_grams / 1000).toFixed(1)}kg: ${(e as Error).message.slice(0, 120)}`);
    }
  }
  return { pushed, skipped, failed, errors };
}
