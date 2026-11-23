/**
 * Put the description and the share card on a Garmin gym activity.
 *
 * The sibling of `enrichGarminRunActivities`, for the other half of what soma sends to Garmin.
 * Runs have had both since the TypeScript cutover; gym workouts lost them on 2026-07-16 when the
 * Python pipeline was deleted, and have reached Garmin (and Strava, which reads the Garmin
 * activity's own description) with neither ever since. Restores
 * `pipeline._enrich_garmin_activity` (soma#982).
 *
 * The two endpoints are the ones the Python used and the run enricher already uses, so nothing
 * new is being learned here: `PUT /activity-service/activity/{id}` carries the description and
 * `POST /activity-service/activity/{id}/image` carries the PNG. garmin-auth's `send()` refreshes
 * the DI token on 401, which is why this does not need the hevy2garmin package's own
 * `setDescription`.
 *
 * EXTERNAL Garmin writes. Idempotent through the `garmin_enrichment` ledger.
 */
import { uploadActivityImage } from "garmin-auth";
import type { GarminClient } from "garmin-auth";
import type { QueryFn } from "./db";
import type { HevyWorkout } from "./hevy-types";
import { computePrs, generateGymDescription } from "./gym-description";
import { synthesizeExerciseSets, timelineFromSamples } from "./set-timing";

/** One workout waiting for its description, joined to everything the text needs. */
interface PendingRow {
  hevy_id: string;
  hevy_title: string | null;
  garmin_activity_id: number;
  workout: HevyWorkout;
  hrSamples: number[];
  hrSource: string;
  avgHr: number | null;
  maxHr: number | null;
  calories: number | null;
  durationS: number | null;
}

/**
 * Gym workouts on Garmin that have not been enriched.
 *
 * `status = 'uploaded'` with an activity id is the pair that says "this is on Garmin and we know
 * which activity it is". The ledger is the dedup, and it is the SAME key the Python wrote, so its
 * 328 existing rows mean the backlog here is only what was missed after it stopped.
 *
 * `LIMIT 10` per run for the same reason the Python had one: this is a Garmin write per row, and
 * a first run after a long gap should spread itself over a few passes rather than hammer the API.
 */
export async function getGymWorkoutsToEnrich(sql: QueryFn, limit = 10): Promise<PendingRow[]> {
  const rows = await sql`
    SELECT we.hevy_id, we.hevy_title, we.garmin_activity_id, we.hr_samples, we.hr_source,
           we.avg_hr, we.max_hr, we.calories, we.duration_s, h.raw_json AS workout
    FROM workout_enrichment we
    JOIN hevy_raw_data h ON h.hevy_id = we.hevy_id AND h.endpoint_name = 'workout'
    WHERE we.status = 'uploaded'
      AND we.garmin_activity_id IS NOT NULL
      AND we.hevy_id NOT IN (
        SELECT source_id FROM activity_sync_log
        WHERE source_platform = 'hevy' AND destination = 'garmin_enrichment' AND status = 'sent'
      )
    ORDER BY we.workout_date DESC
    LIMIT ${limit}`;
  return rows.map((r) => ({
    hevy_id: r.hevy_id,
    hevy_title: r.hevy_title,
    garmin_activity_id: Number(r.garmin_activity_id),
    workout: typeof r.workout === "string" ? JSON.parse(r.workout) : r.workout,
    hrSamples: typeof r.hr_samples === "string" ? JSON.parse(r.hr_samples) : (r.hr_samples ?? []),
    hrSource: r.hr_source ?? "unknown",
    avgHr: r.avg_hr,
    maxHr: r.max_hr,
    calories: r.calories,
    durationS: r.duration_s,
  }));
}

/**
 * The description for one stored workout, with its personal records and per-exercise heart rate.
 *
 * Shared with `GET /api/workout/[id]/description`, so the pipeline and the Strava re-finalize
 * cannot drift apart on the text they produce.
 *
 * ⚠️ Heart rate is only laid across the sets when `hr_source` is `daily`. The `avg_N` and
 * `static` fallbacks are one value repeated thirty times, so slicing them per exercise prints the
 * same number against every exercise, which looks like a measurement and is not. The Python drew
 * the same line (`samples = hr_samples if hr_source == "daily" else None`).
 */
export async function describeGymWorkout(
  sql: QueryFn,
  row: Pick<PendingRow, "hevy_id" | "workout" | "hrSamples" | "hrSource" | "avgHr" | "maxHr" | "calories" | "durationS">,
): Promise<string> {
  const workout = row.workout;
  if (row.hrSource === "daily") {
    const timeline = timelineFromSamples(row.hrSamples, row.durationS);
    if (timeline.length) synthesizeExerciseSets(timeline, workout);
  }
  const prs = await computePrs(sql, row.hevy_id, workout.exercises ?? [], workout.start_time);
  return generateGymDescription(
    workout,
    { avgHr: row.avgHr, maxHr: row.maxHr, calories: row.calories, durationS: row.durationS },
    prs,
  );
}

export interface GymEnrichResult {
  considered: number;
  descriptionsSet: number;
  imagesUploaded: number;
}

/**
 * Describe and illustrate the gym activities that have not been done yet.
 *
 * ⛔ THE LEDGER ROW IS WRITTEN ONLY WHEN THE DESCRIPTION LANDED, and that asymmetry is on
 * purpose. The description is the thing that reaches Strava, so a failed write has to be retried
 * on the next pass. The image is best effort inside the same row: giving it its own ledger key
 * would make every one of the 271 workouts the Python already illustrated look un-illustrated,
 * and re-upload all of them.
 */
export async function enrichGarminGymActivities(
  sql: QueryFn,
  client: GarminClient,
  webBaseUrl: string,
  limit = 10,
): Promise<GymEnrichResult> {
  const pending = await getGymWorkoutsToEnrich(sql, limit);
  let descriptionsSet = 0;
  let imagesUploaded = 0;

  for (const row of pending) {
    const activityId = row.garmin_activity_id;
    let described = false;

    try {
      const desc = await describeGymWorkout(sql, row);
      if (desc) {
        await client.put(`/activity-service/activity/${activityId}`, { activityId, description: desc });
        descriptionsSet += 1;
        described = true;
      }
    } catch (e) {
      console.warn(`  gym ${activityId} description failed: ${(e as Error).message}`);
    }

    // The same card the Strava bridge attaches as the photo, on the Garmin activity too.
    try {
      const resp = await fetch(`${webBaseUrl}/api/workout/${row.hevy_id}/image`);
      if (resp.ok) {
        const bytes = new Uint8Array(await resp.arrayBuffer());
        await uploadActivityImage(client, activityId, bytes, { filename: `workout_${row.hevy_id}.png` });
        imagesUploaded += 1;
      } else {
        console.warn(`  gym ${activityId} image skipped: HTTP ${resp.status}`);
      }
    } catch (e) {
      console.warn(`  gym ${activityId} image failed: ${(e as Error).message}`);
    }

    if (described) {
      try {
        await sql`
          INSERT INTO activity_sync_log (source_platform, source_id, destination, destination_id, rule_id, status)
          VALUES ('hevy', ${row.hevy_id}, 'garmin_enrichment', ${String(activityId)}, ${null}, 'sent')`;
      } catch (e) {
        console.warn(`  gym ${activityId} log failed: ${(e as Error).message}`);
      }
    }
  }

  return { considered: pending.length, descriptionsSet, imagesUploaded };
}
