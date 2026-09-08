import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getRouteSamples, thinSamples } from "@/lib/activity-routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 300;

export async function GET() {
  const sql = getDb();

  // Only ids cross the wire here; the GPS samples come from activity_routes (soma#814), derived
  // once per activity instead of shipping 40 details blobs (7.5 MB) on every call.
  const rows = await sql`
    SELECT s.activity_id
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
  const samples = await getRouteSamples(sql, rows.map((r) => String(r.activity_id)));

  const routes = rows
    .map((row) => thinSamples(samples.get(String(row.activity_id)) ?? [], 20).map(([, lat, lng]) => [lng, lat] as [number, number])) // GeoJSON is [lng, lat]
    .filter((pts) => pts.length > 5);

  return NextResponse.json({ routes });
}
