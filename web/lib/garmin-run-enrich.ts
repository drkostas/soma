/**
 * Garmin run enrichment — TS port of pipeline._enrich_garmin_run_activities +
 * garmin_push.generate_run_strava_description / _get_activity_hr_zones.
 *
 * For recent Garmin run activities not yet enriched, set a generated stats
 * description (PUT) and upload the share card image (multipart POST) to Garmin.
 * The share image is rendered by the existing web route /api/activity/{id}/image.
 * EXTERNAL Garmin writes. Stage: sync cutover (#187).
 */
import type { GarminClient } from "garmin-auth";
import type { QueryFn } from "./db";

const r0 = (x: number) => Math.round(x); // Python round(); values here don't hit binary ties

/** Rich stats description for a Garmin run. Pure. Port of generate_run_strava_description. */
export function generateRunStravaDescription(summary: Record<string, any>, hrZones: Array<Record<string, any>> | null = null): string {
  const lines: string[] = [];
  const SEP = "  ·  ";

  const parts: string[] = [];
  const dist = summary.distance ?? 0;
  if (dist > 0) parts.push(`📏 ${(dist / 1000).toFixed(2)} km`);
  const avgSpeed = summary.averageSpeed ?? 0;
  if (avgSpeed > 0) {
    const pace = 1000 / avgSpeed / 60;
    const m = Math.trunc(pace);
    parts.push(`⚡ ${m}:${String(r0((pace - m) * 60)).padStart(2, "0")}/km`);
  }
  const avgHr = summary.averageHR ?? 0;
  if (avgHr > 0) parts.push(`❤️ ${r0(avgHr)} bpm`);
  if (parts.length) lines.push(parts.join(SEP));

  const parts2: string[] = [];
  const elev = summary.elevationGain ?? 0;
  if (elev > 0) parts2.push(`📈 +${r0(elev)} m`);
  const cals = summary.calories ?? 0;
  if (cals > 0) parts2.push(`🔥 ${r0(cals)} kcal`);
  const maxHr = summary.maxHR ?? 0;
  if (maxHr > 0) parts2.push(`Max HR: ${r0(maxHr)}`);
  if (parts2.length) lines.push(parts2.join(SEP));

  const parts3: string[] = [];
  const vo2 = summary.vO2MaxValue ?? 0;
  if (vo2 && Number(vo2) > 0) parts3.push(`VO2max: ${Number(vo2).toFixed(1)}`);
  const te = summary.aerobicTrainingEffect ?? 0;
  if (te && Number(te) > 0) parts3.push(`Training Effect: ${Number(te).toFixed(1)}`);
  const cadence = summary.averageRunningCadenceInStepsPerMinute ?? 0;
  if (cadence > 0) parts3.push(`Cadence: ${r0(cadence)} spm`);
  if (parts3.length) lines.push(parts3.join(SEP));

  if (hrZones && hrZones.length) {
    const totalSecs = hrZones.reduce((s, z) => s + (z.secsInZone ?? 0), 0);
    if (totalSecs > 0) {
      const labels = ["Z1", "Z2", "Z3", "Z4", "Z5"];
      const zoneParts: string[] = [];
      hrZones.slice(0, 5).forEach((z, i) => {
        const pct = r0(((z.secsInZone ?? 0) / totalSecs) * 100);
        if (pct >= 5) zoneParts.push(`${labels[i]}: ${pct}%`);
      });
      if (zoneParts.length) lines.push("Zones: " + zoneParts.join(SEP));
    }
  }

  if (lines.length) {
    lines.push("");
    lines.push("Tracked by github.com/drkostas/soma");
  }
  return lines.join("\n");
}

/** Fetch stored HR-zones JSON for an activity, or null. Port of _get_activity_hr_zones. */
export async function getActivityHrZones(sql: QueryFn, activityId: number): Promise<Array<Record<string, any>> | null> {
  const rows = await sql`
    SELECT raw_json FROM garmin_activity_raw WHERE activity_id = ${activityId} AND endpoint_name = 'hr_zones'`;
  if (!rows.length) return null;
  const raw = typeof rows[0].raw_json === "string" ? JSON.parse(rows[0].raw_json) : rows[0].raw_json;
  return Array.isArray(raw) ? raw : null;
}

export interface EnrichResult { enriched: number; descriptionSet: number; imagesUploaded: number; }

/**
 * Enrich recent Garmin run activities (last 48h, not yet imaged): set the stats
 * description and upload the share image. Port of _enrich_garmin_run_activities.
 * DB + EXTERNAL Garmin writes. Logs dest='garmin_image' only on image success so
 * failures retry. webBaseUrl is where /api/activity/{id}/image is served.
 */
export async function enrichGarminRunActivities(sql: QueryFn, client: GarminClient, webBaseUrl: string): Promise<EnrichResult> {
  const rows = await sql`
    SELECT activity_id, raw_json FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
      AND synced_at >= NOW() - INTERVAL '48 hours'
      AND COALESCE(raw_json->>'manufacturer', '') != 'DEVELOPMENT'
      AND (raw_json->'activityType'->>'typeKey') IN ('running', 'trail_running', 'treadmill_running')
      AND activity_id::text NOT IN (
        SELECT source_id FROM activity_sync_log
        WHERE source_platform = 'garmin' AND destination = 'garmin_image' AND status = 'sent')
    ORDER BY raw_json->>'startTimeGMT' DESC`;

  let enriched = 0, descriptionSet = 0, imagesUploaded = 0;
  for (const row of rows) {
    const activityId = Number(row.activity_id);
    const summary = typeof row.raw_json === "string" ? JSON.parse(row.raw_json) : row.raw_json;

    // Description (PUT). Non-fatal.
    try {
      const hrZones = await getActivityHrZones(sql, activityId);
      const desc = generateRunStravaDescription(summary, hrZones);
      if (desc) {
        await client.put(`/activity-service/activity/${activityId}`, { activityId, description: desc });
        descriptionSet += 1;
      }
    } catch (e) {
      console.warn(`  run ${activityId} description failed: ${(e as Error).message}`);
    }

    // Share image (multipart POST). Fetched from the web render route.
    let imageOk = false;
    try {
      const resp = await fetch(`${webBaseUrl}/api/activity/${activityId}/image`);
      if (resp.ok) {
        const bytes = new Uint8Array(await resp.arrayBuffer());
        const form = new FormData();
        form.append("file", new Blob([bytes], { type: "image/png" }), `run_${activityId}.png`);
        await client.postForm(`/activity-service/activity/${activityId}/image`, form);
        imagesUploaded += 1;
        imageOk = true;
      }
    } catch (e) {
      console.warn(`  run ${activityId} image failed: ${(e as Error).message}`);
    }

    // Log only on image success (so failures retry).
    if (imageOk) {
      try {
        await sql`
          INSERT INTO activity_sync_log (source_platform, source_id, destination, destination_id, rule_id, status)
          VALUES ('garmin', ${String(activityId)}, 'garmin_image', ${String(activityId)}, ${null}, 'sent')`;
      } catch (e) {
        console.warn(`  run ${activityId} log failed: ${(e as Error).message}`);
      }
    }
    enriched += 1;
  }
  return { enriched, descriptionSet, imagesUploaded };
}
