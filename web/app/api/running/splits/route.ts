import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "edge";

/**
 * Per-km split analysis + fastest single-km splits as JSON for the app running
 * screen (the web reads garmin_activity_raw server-side). Mirrors
 * getSplitAnalysis + getBestSplits in app/running/page.tsx.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = searchParams.get("range") || "1y";
  const days = range === "90d" ? 90 : range === "6m" ? 182 : range === "2y" ? 730 : 365;

  const sql = getDb();

  const perKm = (await sql`
    WITH recent_activities AS (
      SELECT activity_id FROM garmin_activity_raw
      WHERE endpoint_name = 'summary'
        AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
        AND (raw_json->>'startTimeLocal')::timestamp >= CURRENT_DATE - ${days}::int
    ),
    split_data AS (
      SELECT (lap->>'lapIndex')::int as lap_index,
        (lap->>'distance')::float as distance,
        (lap->>'duration')::float as duration,
        (lap->>'averageHR')::float as avg_hr,
        (lap->>'averageRunCadence')::float * 2 as cadence
      FROM garmin_activity_raw s, jsonb_array_elements(s.raw_json->'lapDTOs') as lap
      WHERE s.endpoint_name = 'splits'
        AND s.activity_id IN (SELECT activity_id FROM recent_activities)
        AND (lap->>'distance')::float BETWEEN 800 AND 1200
        AND (lap->>'duration')::float > 0
    )
    SELECT lap_index as km, COUNT(*) as runs,
      AVG(duration / NULLIF(distance / 1000.0, 0) / 60.0) as avg_pace,
      AVG(avg_hr) as avg_hr, AVG(cadence) as avg_cadence,
      PERCENTILE_CONT(0.1) WITHIN GROUP (ORDER BY duration / NULLIF(distance / 1000.0, 0) / 60.0) as fast_pace,
      PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY duration / NULLIF(distance / 1000.0, 0) / 60.0) as slow_pace
    FROM split_data WHERE lap_index < 15
    GROUP BY lap_index HAVING COUNT(*) >= 10 ORDER BY lap_index ASC
  `) as { km: number; runs: number; avg_pace: number | null; avg_hr: number | null; avg_cadence: number | null; fast_pace: number | null; slow_pace: number | null }[];

  const best = (await sql`
    WITH recent_activities AS (
      SELECT activity_id FROM garmin_activity_raw
      WHERE endpoint_name = 'summary'
        AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
        AND (raw_json->>'startTimeLocal')::timestamp >= CURRENT_DATE - ${days}::int
    ),
    split_data AS (
      SELECT s.activity_id, (lap->>'lapIndex')::int as lap_index,
        (lap->>'distance')::float as distance, (lap->>'duration')::float as duration
      FROM garmin_activity_raw s, jsonb_array_elements(s.raw_json->'lapDTOs') as lap
      WHERE s.endpoint_name = 'splits'
        AND s.activity_id IN (SELECT activity_id FROM recent_activities)
        AND (lap->>'distance')::float BETWEEN 800 AND 1200
        AND (lap->>'duration')::float > 0
    ),
    with_pace AS (SELECT *, duration / NULLIF(distance / 1000.0, 0) / 60.0 as pace FROM split_data)
    SELECT wp.lap_index as km, wp.pace,
      (sm.raw_json->>'startTimeLocal')::text as date,
      (sm.raw_json->>'activityName')::text as activity_name
    FROM with_pace wp
    JOIN garmin_activity_raw sm ON sm.activity_id = wp.activity_id AND sm.endpoint_name = 'summary'
    WHERE wp.pace BETWEEN 2.5 AND 10
    ORDER BY wp.pace ASC LIMIT 5
  `) as { km: number; pace: number; date: string; activity_name: string | null }[];

  return NextResponse.json({ perKm, best });
}
