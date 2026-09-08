/**
 * Derived GPS samples per Garmin activity (soma#814).
 *
 * The running heatmap and the Recent Routes card used to pull the whole `details` blob of every
 * candidate activity (about 190 KB each, 40 of them for the heatmap) out of Neon on every request,
 * then keep a few hundred lat/lng pairs. That was 7.5 MB of database transfer per heatmap call and
 * the largest single consumer of the Free plan's monthly allowance.
 *
 * `activity_routes` keeps one sample per `KEEP_EVERY` metric rows: `[metricIndex, lat, lng, speed]`
 * for every kept row that has a fix. Callers thin by the original metric index (`index % thin
 * === 0`, with `thin` a multiple of `KEEP_EVERY`), which reproduces the previous extractors byte
 * for byte, including the rows they skipped for a missing fix. Rows are derived lazily on first
 * read from `details` and inserted; nothing about ingest changes.
 */
import type { QueryFn } from "./db";

/** [metricIndex, lat, lng, speed|null] */
export type RouteSample = [number, number, number, number | null];
/** Stored resolution: every 4th metric row. Both readers thin by a multiple of 4 (8 and 20), so
 *  the stored subset still yields their exact selections at a quarter of the bytes. */
export const KEEP_EVERY = 4;

let ensured: Promise<void> | null = null;
/** Additive, idempotent; memoised per process. Never rejects the caller's query on failure. */
export function ensureActivityRoutesTable(sql: QueryFn): Promise<void> {
  if (!ensured) {
    ensured = sql`
      CREATE TABLE IF NOT EXISTS activity_routes (
        activity_id BIGINT PRIMARY KEY,
        samples JSONB NOT NULL,
        sample_count INT NOT NULL,
        derived_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`.then(() => undefined).catch(() => { ensured = null; });
  }
  return ensured;
}

/** Full-resolution samples from a Garmin `details` payload, tagged with their metric index. */
export function deriveRouteSamples(details: any): RouteSample[] {
  if (!details?.metricDescriptors || !details?.activityDetailMetrics) return [];
  const keyIndex: Record<string, number> = {};
  for (const desc of details.metricDescriptors as Array<{ key: string; metricsIndex: number }>) {
    keyIndex[desc.key] = desc.metricsIndex;
  }
  const latIdx = keyIndex["directLatitude"];
  const lngIdx = keyIndex["directLongitude"];
  const speedIdx = keyIndex["directSpeed"];
  if (latIdx == null || lngIdx == null) return [];
  const metrics = details.activityDetailMetrics as Array<{ metrics: number[] }>;
  const out: RouteSample[] = [];
  for (let i = 0; i < metrics.length; i += KEEP_EVERY) {
    const m = metrics[i]?.metrics;
    if (!m) continue;
    const lat = m[latIdx];
    const lng = m[lngIdx];
    if (lat == null || lng == null || (lat === 0 && lng === 0)) continue;
    out.push([i, lat, lng, speedIdx != null ? (m[speedIdx] ?? null) : null]);
  }
  return out;
}

/** Every `thin`-th metric row that had a fix, in metric order: the legacy extractors' selection. */
export function thinSamples(samples: RouteSample[], thin: number): RouteSample[] {
  if (thin % KEEP_EVERY !== 0) throw new Error(`thin must be a multiple of ${KEEP_EVERY}, got ${thin}`);
  return samples.filter((s) => s[0] % thin === 0);
}

/**
 * Samples for the given activity ids, from `activity_routes` where present, else derived from
 * `details` once and stored. Ids without a usable `details` row map to an empty list.
 */
export async function getRouteSamples(sql: QueryFn, ids: Array<string | number>): Promise<Map<string, RouteSample[]>> {
  const out = new Map<string, RouteSample[]>();
  if (!ids.length) return out;
  const wanted = ids.map((i) => String(i));
  await ensureActivityRoutesTable(sql);
  const cached = await sql`
    SELECT activity_id, samples FROM activity_routes WHERE activity_id = ANY(${wanted}::bigint[])`.catch(() => []);
  for (const r of cached) out.set(String(r.activity_id), (typeof r.samples === "string" ? JSON.parse(r.samples) : r.samples) as RouteSample[]);
  const missing = wanted.filter((id) => !out.has(id));
  if (!missing.length) return out;
  // First read of these activities: the only time the blobs cross the wire.
  const rows = await sql`
    SELECT activity_id, raw_json FROM garmin_activity_raw
    WHERE endpoint_name = 'details' AND activity_id = ANY(${missing}::bigint[])`;
  for (const r of rows) {
    const id = String(r.activity_id);
    const samples = deriveRouteSamples(typeof r.raw_json === "string" ? JSON.parse(r.raw_json) : r.raw_json);
    out.set(id, samples);
    await sql`
      INSERT INTO activity_routes (activity_id, samples, sample_count)
      VALUES (${id}::bigint, ${JSON.stringify(samples)}::jsonb, ${samples.length})
      ON CONFLICT (activity_id) DO NOTHING`.catch(() => {});
  }
  for (const id of missing) if (!out.has(id)) out.set(id, []);
  return out;
}
