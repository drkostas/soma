import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getRouteSamples, thinSamples } from "@/lib/activity-routes";

export const runtime = "nodejs";
export const revalidate = 300;

export async function GET() {
  const sql = getDb();

  const rows = await sql`
    SELECT
      s.activity_id,
      s.raw_json AS summary
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

  // GPS samples from activity_routes (soma#814) instead of six details blobs per call.
  const samples = await getRouteSamples(sql, rows.map((r) => String(r.activity_id)));
  const result = rows.map((row) => {
    const summary = row.summary as any;
    const gps_points = thinSamples(samples.get(String(row.activity_id)) ?? [], 8).map(([, lat, lng, speed]) => ({
      lat, lng, hr: null as null, speed, elev: null as null, cadence: null as null, dist_m: null as null,
    }));
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
