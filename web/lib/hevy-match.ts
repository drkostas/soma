/**
 * Mark Hevy workouts that already exist on Garmin as uploaded, so they are not
 * re-uploaded: reads both lists from the DB, matches them with the package's
 * timestamp matcher, and records the pairs on workout_enrichment. No Garmin
 * writes. A dedup layer for Stage 2 (#184).
 */
import type { QueryFn } from "./db";
import { matchHevyToGarmin, toUtcDate, type HevyDt, type GarminAct } from "hevy2garmin";

export { matchHevyToGarmin, toUtcDate };
export type { HevyDt, GarminAct };

/**
 * Load Hevy workout times + Garmin strength activities from the DB, match, and
 * mark matched workouts as uploaded (garmin_activity_id set). Returns match count.
 */
export async function populateGarminIds(sql: QueryFn): Promise<number> {
  const hevyRows = await sql`
    SELECT raw_json->>'id' AS hevy_id, raw_json->>'start_time' AS start_time
    FROM hevy_raw_data WHERE endpoint_name = 'workout'`;
  const hevyDts: HevyDt[] = [];
  for (const r of hevyRows) {
    const d = toUtcDate(r.start_time);
    if (d) hevyDts.push({ hevyId: r.hevy_id, date: d });
  }

  const gRows = await sql`
    SELECT activity_id, raw_json->>'startTimeGMT' AS start_gmt
    FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
      AND raw_json->'activityType'->>'typeKey' = 'strength_training'`;
  const garminActs: GarminAct[] = gRows
    .filter((r) => r.start_gmt)
    .map((r) => ({ gmt: r.start_gmt, aid: Number(r.activity_id) }));

  const matches = matchHevyToGarmin(hevyDts, garminActs);
  for (const m of matches) {
    await sql`
      UPDATE workout_enrichment
      SET garmin_activity_id = ${m.aid}, status = 'uploaded', updated_at = NOW()
      WHERE hevy_id = ${m.hevyId}`;
  }
  return matches.length;
}
