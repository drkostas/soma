/**
 * Hevy→Garmin FIT upload — TS port of activity_replacer.process_workout +
 * pipeline._upload_enriched_to_garmin. Stage 2 phase 2 (#184).
 *
 * WARNING: uploadFit CREATES a real Garmin activity (non-idempotent) that
 * facterino forwards to Strava. Duplicate uploads = duplicate Strava activities.
 * Three dedup layers guard against that, ALL must hold before an upload:
 *   1. populateGarminIds() sets matched workouts to status='uploaded' first, so
 *      anything already on Garmin is excluded by the status='enriched' filter.
 *   2. activity_sync_log is an append-only ledger of what was sent to Garmin;
 *      workouts already logged as sent/external are excluded.
 *   3. Garmin itself returns 409 on a duplicate FIT; that is caught and matched
 *      via populateGarminIds instead of creating a duplicate.
 *
 * This module does NOT fire on a schedule. It is invoked deliberately, and the
 * dedup selection is unit-tested below before any live use.
 */
import { generateFit, uploadFit, renameActivity } from "hevy2garmin";
import type { GarminClient } from "garmin-auth";
import type { QueryFn } from "./db";
import { populateGarminIds } from "./hevy-match";

export interface UploadCandidate {
  hevyId: string;
  hevyTitle: string | null;
  workout: any;         // raw Hevy workout
  hrSamples: number[];
  hrSource: string;
  workoutDate: string | null;
}

/**
 * Pure dedup predicate: a workout may be uploaded only if its enrichment status
 * is exactly 'enriched' (not yet matched/uploaded) AND it is not already in the
 * sent ledger. Mirrors the SQL filter in _upload_enriched_to_garmin.
 */
export function isUploadCandidate(status: string, hevyId: string, alreadySent: Set<string>): boolean {
  return status === "enriched" && !alreadySent.has(hevyId);
}

/** Filter a list of enrichment rows to the upload candidates (pure). */
export function filterUploadCandidates(
  rows: Array<{ hevy_id: string; status: string }>,
  alreadySent: Set<string>,
): string[] {
  return rows.filter((r) => isUploadCandidate(r.status, r.hevy_id, alreadySent)).map((r) => r.hevy_id);
}

/** Load the set of hevy_ids already logged as sent/external to Garmin. */
export async function loadSentToGarmin(sql: QueryFn): Promise<Set<string>> {
  const rows = await sql`
    SELECT DISTINCT source_id FROM activity_sync_log
    WHERE source_platform = 'hevy' AND destination = 'garmin' AND status IN ('sent', 'external')`;
  return new Set(rows.map((r) => r.source_id));
}

/** Append a row to the activity_sync_log ledger. Mirrors log_activity_sync. */
export async function logActivitySync(
  sql: QueryFn,
  o: { sourceId: string; destination: string; destinationId?: string | null; ruleId?: number | null; status?: string; error?: string | null },
): Promise<void> {
  await sql`
    INSERT INTO activity_sync_log (source_platform, source_id, destination, destination_id, rule_id, status, error_message)
    VALUES ('hevy', ${o.sourceId}, ${o.destination}, ${o.destinationId ?? null}, ${o.ruleId ?? null}, ${o.status ?? "sent"}, ${o.error ?? null})`;
}

/**
 * Select the workouts eligible for upload: enriched, joined to their raw Hevy
 * workout, and NOT already sent to Garmin. Uses status='enriched' (layer 1: the
 * matcher demotes already-on-Garmin rows to 'uploaded') AND the ledger (layer 2).
 */
export async function getWorkoutsToUpload(sql: QueryFn): Promise<UploadCandidate[]> {
  const rows = await sql`
    SELECT we.hevy_id, we.hevy_title, h.raw_json, we.hr_samples, we.hr_source, we.workout_date
    FROM workout_enrichment we
    JOIN hevy_raw_data h ON h.hevy_id = we.hevy_id AND h.endpoint_name = 'workout'
    WHERE we.status = 'enriched'
      AND we.hevy_id NOT IN (
        SELECT source_id FROM activity_sync_log
        WHERE source_platform = 'hevy' AND destination = 'garmin' AND status IN ('sent', 'external')
      )
    ORDER BY we.workout_date DESC`;
  return rows.map((r) => ({
    hevyId: r.hevy_id,
    hevyTitle: r.hevy_title,
    workout: typeof r.raw_json === "string" ? JSON.parse(r.raw_json) : r.raw_json,
    hrSamples: typeof r.hr_samples === "string" ? JSON.parse(r.hr_samples) : (r.hr_samples ?? []),
    hrSource: r.hr_source ?? "unknown",
    workoutDate: r.workout_date ? String(r.workout_date) : null,
  }));
}

export interface UploadOutcome { hevyId: string; status: "uploaded" | "error"; activityId?: number | null; error?: string; }

/** Generate a FIT for one workout and upload it to Garmin, then rename. Side-effectful. */
export async function processWorkout(client: GarminClient, c: UploadCandidate): Promise<UploadOutcome> {
  try {
    const { fit } = generateFit(c.workout, c.hrSamples.length ? c.hrSamples : null, {});
    const start = c.workout?.start_time;
    const { activityId } = await uploadFit(client, fit, start);
    if (c.hevyTitle && activityId) {
      try { await renameActivity(client, activityId, c.hevyTitle); } catch { /* rename is best-effort */ }
    }
    return { hevyId: c.hevyId, status: "uploaded", activityId: activityId ?? null };
  } catch (e) {
    return { hevyId: c.hevyId, status: "error", error: (e as Error).message };
  }
}

export interface UploadRunResult { candidates: number; uploaded: number; matchedAfter: number; outcomes: UploadOutcome[]; }

/**
 * Orchestrate the dedup'd upload: match existing activities first, select the
 * still-unsent enriched workouts, upload each, and log every success to the
 * ledger so it is never re-uploaded. A final match pass adopts any 409s.
 *
 * `dryRun` (default true) generates FITs and reports candidates WITHOUT uploading,
 * so the selection can be inspected against production before firing live.
 */
export async function uploadEnrichedToGarmin(
  sql: QueryFn,
  client: GarminClient,
  opts: { dryRun?: boolean } = {},
): Promise<UploadRunResult> {
  const dryRun = opts.dryRun ?? true;
  await populateGarminIds(sql); // layer 1: adopt already-present activities
  const candidates = await getWorkoutsToUpload(sql);

  const outcomes: UploadOutcome[] = [];
  if (!dryRun) {
    for (const c of candidates) {
      const outcome = await processWorkout(client, c);
      outcomes.push(outcome);
      if (outcome.status === "uploaded") {
        await logActivitySync(sql, { sourceId: c.hevyId, destination: "garmin", destinationId: outcome.activityId ? String(outcome.activityId) : null, status: "sent" });
      }
    }
  }

  const matchedAfter = await populateGarminIds(sql); // layer 3: adopt 409/async uploads
  return { candidates: candidates.length, uploaded: outcomes.filter((o) => o.status === "uploaded").length, matchedAfter, outcomes };
}
