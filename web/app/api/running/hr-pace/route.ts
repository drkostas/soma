import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "edge";

/**
 * Per-run pace vs heart-rate points as JSON for the app running screen's
 * HR-vs-pace scatter (the web reads garmin_activity_raw server-side). Mirrors
 * getHRPaceData in app/running/page.tsx.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = searchParams.get("range") || "1y";
  const days = range === "90d" ? 90 : range === "6m" ? 182 : range === "2y" ? 730 : 365;

  const sql = getDb();
  const points = (await sql`
    SELECT
      (raw_json->>'startTimeLocal')::text as date,
      (raw_json->>'activityName')::text as name,
      (raw_json->>'duration')::float / NULLIF((raw_json->>'distance')::float / 1000.0, 0) / 60.0 as pace,
      (raw_json->>'averageHR')::float as hr,
      (raw_json->>'distance')::float / 1000.0 as distance
    FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
      AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
      AND (raw_json->>'distance')::float > 1000
      AND (raw_json->>'averageHR')::float > 60
      AND (raw_json->>'duration')::float / NULLIF((raw_json->>'distance')::float / 1000.0, 0) / 60.0 BETWEEN 3.0 AND 10.0
      AND (raw_json->>'startTimeLocal')::timestamp >= CURRENT_DATE - ${days}::int
    ORDER BY (raw_json->>'startTimeLocal')::text ASC
  `) as { date: string; name: string | null; pace: number | null; hr: number | null; distance: number | null }[];

  return NextResponse.json({ points });
}
