/**
 * Hevy workout ingestion — TS port of sync/src/hevy_sync.py::sync_all_workouts.
 * Stage 2 of soma-core (#184). Pulls Hevy workouts newest-first, incrementally,
 * upserting changed ones into hevy_raw_data. Runs alongside the Python sync
 * (idempotent upserts). The Hevy→FIT→Garmin upload is a separate step.
 */
import { HevyClient } from "hevy2garmin";
import type { QueryFn } from "./db";

export type KnownTimestamps = Record<string, string>;

export interface PagePartition {
  /** Workouts new or changed since the DB copy (wid + full workout). */
  toSave: Array<{ wid: string; updatedAt: string; workout: any }>;
  /** True when every workout on the page is already known and unchanged. */
  allKnown: boolean;
}

/**
 * Decide which workouts on a page need saving. Pure port of the inner loop of
 * sync_all_workouts: save when unseen or updated_at changed; a page is "all
 * known" only if none needed saving.
 */
export function partitionWorkouts(workouts: any[], known: KnownTimestamps): PagePartition {
  const toSave: PagePartition["toSave"] = [];
  let allKnown = true;
  for (const workout of workouts) {
    const wid: string = workout?.id ?? "";
    const updatedAt: string = workout?.updated_at ?? "";
    if (wid && known[wid] === updatedAt) continue; // exact version already stored
    allKnown = false;
    if (wid) toSave.push({ wid, updatedAt, workout });
  }
  return { toSave, allKnown };
}

async function upsertHevyRaw(sql: QueryFn, hevyId: string, endpoint: string, data: unknown): Promise<void> {
  await sql`
    INSERT INTO hevy_raw_data (hevy_id, endpoint_name, raw_json)
    VALUES (${hevyId}, ${endpoint}, ${JSON.stringify(data)}::jsonb)
    ON CONFLICT (hevy_id, endpoint_name)
    DO UPDATE SET raw_json = EXCLUDED.raw_json, synced_at = NOW()`;
}

async function knownWorkoutTimestamps(sql: QueryFn): Promise<KnownTimestamps> {
  const rows = await sql`
    SELECT hevy_id, raw_json->>'updated_at' AS updated_at
    FROM hevy_raw_data WHERE endpoint_name = 'workout'`;
  const out: KnownTimestamps = {};
  for (const r of rows) out[r.hevy_id] = r.updated_at ?? "";
  return out;
}

export interface HevySyncResult {
  totalCount: number;
  saved: number;
  skipped: number;
  pagesScanned: number;
}

/**
 * Fetch Hevy workouts incrementally, stopping once a full page is unchanged
 * (Hevy returns newest-first, so older pages are then also unchanged).
 */
export async function syncAllWorkouts(
  client: HevyClient,
  sql: QueryFn,
  opts: { startPage?: number; pageSize?: number } = {},
): Promise<HevySyncResult> {
  const pageSize = opts.pageSize ?? 10;
  let page = opts.startPage ?? 1;
  const totalCount = await client.getWorkoutCount();
  const known = await knownWorkoutTimestamps(sql);

  let saved = 0, skipped = 0, pagesScanned = 0;
  while (true) {
    let data: { workouts?: any[]; page_count?: number };
    try {
      data = await client.getWorkouts(page, pageSize);
    } catch (e) {
      console.warn(`  Error fetching page ${page}: ${(e as Error).message}. Retry next run.`);
      break;
    }
    const workouts = data.workouts ?? [];
    if (!workouts.length) break;
    pagesScanned += 1;

    const { toSave, allKnown } = partitionWorkouts(workouts, known);
    skipped += workouts.length - toSave.length;
    for (const { wid, updatedAt, workout } of toSave) {
      try {
        await upsertHevyRaw(sql, wid, "workout", workout);
        saved += 1;
        known[wid] = updatedAt;
      } catch (e) {
        console.warn(`  Error saving workout ${wid}: ${(e as Error).message}`);
      }
    }

    const pageCount = data.page_count ?? page;
    if (allKnown) break;          // all older pages are unchanged too
    if (page >= pageCount) break;
    page += 1;
  }
  return { totalCount, saved, skipped, pagesScanned };
}
