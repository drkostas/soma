import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Extract lat/lng only — heavier thinning for heatmap (many routes on one map)
function extractLatLng(details: any, thin = 20): Array<[number, number]> {
  if (!details?.metricDescriptors || !details?.activityDetailMetrics) return [];

  const keyIndex: Record<string, number> = {};
  for (const desc of details.metricDescriptors as Array<{ key: string; metricsIndex: number }>) {
    keyIndex[desc.key] = desc.metricsIndex;
  }

  const latIdx = keyIndex["directLatitude"];
  const lngIdx = keyIndex["directLongitude"];
  if (latIdx == null || lngIdx == null) return [];

  const points: Array<[number, number]> = [];
  const metrics = details.activityDetailMetrics as Array<{ metrics: number[] }>;

  for (let i = 0; i < metrics.length; i += thin) {
    const m = metrics[i]?.metrics;
    if (!m) continue;
    const lat = m[latIdx];
    const lng = m[lngIdx];
    if (lat == null || lng == null || (lat === 0 && lng === 0)) continue;
    points.push([lng, lat]); // GeoJSON is [lng, lat]
  }
  return points;
}

export async function GET() {
  const sql = getDb();

  const rows = await sql`
    SELECT
      d.raw_json AS details
    FROM garmin_activity_raw s
    JOIN garmin_activity_raw d
      ON d.activity_id = s.activity_id AND d.endpoint_name = 'details'
    WHERE s.endpoint_name = 'summary'
      AND s.raw_json->'activityType'->>'typeKey' IN ('running', 'trail_running')
      AND d.raw_json ? 'metricDescriptors'
      AND (s.raw_json->>'startTimeLocal')::timestamp >= CURRENT_DATE - INTERVAL '12 months'
    ORDER BY (s.raw_json->>'startTimeLocal')::text DESC
    LIMIT 40
  `;

  const routes = rows
    .map((row) => extractLatLng(row.details, 20))
    .filter((pts) => pts.length > 5);

  return NextResponse.json({ routes });
}
