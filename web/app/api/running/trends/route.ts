import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "edge";

/**
 * Training-load/ACWR trend + cadence/stride as JSON for the app running screen
 * (the web reads garmin_raw_data / garmin_activity_raw server-side). Mirrors
 * getTrainingLoadTrend + getCadenceStride in app/running/page.tsx.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = searchParams.get("range") || "180d";
  const days = range === "30d" ? 30 : range === "90d" ? 90 : range === "1y" ? 365 : range === "2y" ? 730 : 180;

  const sql = getDb();

  const loadTrend = (await sql`
    SELECT date::text as date,
      (SELECT v->'acuteTrainingLoadDTO'->>'dailyTrainingLoadAcute'
       FROM jsonb_each(raw_json->'mostRecentTrainingStatus'->'latestTrainingStatusData') AS t(k, v) LIMIT 1)::float as acute,
      (SELECT v->'acuteTrainingLoadDTO'->>'dailyTrainingLoadChronic'
       FROM jsonb_each(raw_json->'mostRecentTrainingStatus'->'latestTrainingStatusData') AS t(k, v) LIMIT 1)::float as chronic,
      (SELECT v->'acuteTrainingLoadDTO'->>'dailyAcuteChronicWorkloadRatio'
       FROM jsonb_each(raw_json->'mostRecentTrainingStatus'->'latestTrainingStatusData') AS t(k, v) LIMIT 1)::float as acwr
    FROM garmin_raw_data
    WHERE endpoint_name = 'training_status'
      AND raw_json->'mostRecentTrainingStatus' IS NOT NULL
      AND date >= CURRENT_DATE - ${days}::int
    ORDER BY date ASC
  `) as { date: string; acute: number | null; chronic: number | null; acwr: number | null }[];

  const cadenceStride = (await sql`
    SELECT (raw_json->>'startTimeLocal')::text as date,
      ROUND((raw_json->>'averageRunningCadenceInStepsPerMinute')::numeric, 0)::int as cadence,
      ROUND((raw_json->>'avgStrideLength')::numeric, 0)::int as stride
    FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
      AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
      AND raw_json->>'averageRunningCadenceInStepsPerMinute' IS NOT NULL
      AND (raw_json->>'averageRunningCadenceInStepsPerMinute')::float >= 120
      AND (raw_json->>'distance')::float > 1000
      AND (raw_json->>'startTimeLocal')::timestamp >= CURRENT_DATE - ${days}::int
    ORDER BY (raw_json->>'startTimeLocal')::timestamp ASC
  `) as { date: string; cadence: number | null; stride: number | null }[];

  return NextResponse.json({ loadTrend, cadenceStride });
}
