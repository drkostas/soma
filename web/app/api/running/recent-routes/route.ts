import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const revalidate = 300;

function extractGpsPoints(
  details: any,
  thin = 8
): Array<{ lat: number; lng: number; hr: null; speed: number | null; elev: null; cadence: null; dist_m: null }> {
  if (!details?.metricDescriptors || !details?.activityDetailMetrics) return [];

  const keyIndex: Record<string, number> = {};
  for (const desc of details.metricDescriptors as Array<{ key: string; metricsIndex: number }>) {
    keyIndex[desc.key] = desc.metricsIndex;
  }

  const latIdx = keyIndex["directLatitude"];
  const lngIdx = keyIndex["directLongitude"];
  const speedIdx = keyIndex["directSpeed"];
  if (latIdx == null || lngIdx == null) return [];

  const points: Array<{ lat: number; lng: number; hr: null; speed: number | null; elev: null; cadence: null; dist_m: null }> = [];
  const metrics = details.activityDetailMetrics as Array<{ metrics: number[] }>;

  for (let i = 0; i < metrics.length; i += thin) {
    const m = metrics[i]?.metrics;
    if (!m) continue;
    const lat = m[latIdx];
    const lng = m[lngIdx];
    if (lat == null || lng == null || (lat === 0 && lng === 0)) continue;
    points.push({
      lat,
      lng,
      hr: null,
      speed: speedIdx != null ? (m[speedIdx] ?? null) : null,
      elev: null,
      cadence: null,
      dist_m: null,
    });
  }
  return points;
}

export async function GET() {
  const sql = getDb();

  const rows = await sql`
    SELECT
      s.activity_id,
      s.raw_json AS summary,
      d.raw_json AS details
    FROM garmin_activity_raw s
    JOIN garmin_activity_raw d
      ON d.activity_id = s.activity_id AND d.endpoint_name = 'details'
    WHERE s.endpoint_name = 'summary'
      AND s.raw_json->'activityType'->>'typeKey' IN ('running', 'trail_running')
      AND d.raw_json ? 'metricDescriptors'
      AND (s.raw_json->>'startTimeLocal')::timestamp >= CURRENT_DATE - INTERVAL '2 years'
    ORDER BY (s.raw_json->>'startTimeLocal')::text DESC
    LIMIT 6
  `;

  const result = rows.map((row) => {
    const summary = row.summary as any;
    const gps_points = extractGpsPoints(row.details, 8);
    return {
      activity_id: String(row.activity_id),
      name: summary.activityName || "Run",
      date: (summary.startTimeLocal || "").slice(0, 10),
      distance_km: (Number(summary.distance) || 0) / 1000,
      duration_s: Number(summary.duration) || 0,
      gps_points,
    };
  });

  return NextResponse.json(result);
}
