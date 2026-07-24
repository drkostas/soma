import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "edge";

/**
 * Weekday vs weekend sleep comparison as JSON for the app sleep screen (the web
 * computes this server-side). Mirrors getWeekdayWeekendSleep in app/sleep/page.tsx.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = searchParams.get("range") || "90d";
  const days = range === "30d" ? 30 : range === "1y" ? 365 : 90;

  const sql = getDb();
  const rows = (await sql`
    SELECT
      CASE WHEN EXTRACT(DOW FROM date) IN (0, 6) THEN 'weekend' ELSE 'weekday' END as day_type,
      AVG((raw_json->'dailySleepDTO'->>'sleepTimeSeconds')::float) / 3600.0 as avg_hours,
      AVG((raw_json->'dailySleepDTO'->'sleepScores'->'overall'->>'value')::float) as avg_score,
      AVG((raw_json->'dailySleepDTO'->>'deepSleepSeconds')::float /
          NULLIF((raw_json->'dailySleepDTO'->>'sleepTimeSeconds')::float, 0) * 100) as avg_deep_pct,
      COUNT(*) as nights
    FROM garmin_raw_data
    WHERE endpoint_name = 'sleep_data'
      AND (raw_json->'dailySleepDTO'->>'sleepTimeSeconds')::int > 0
      AND date >= CURRENT_DATE - ${days}::int
    GROUP BY day_type
  `) as { day_type: string; avg_hours: number | null; avg_score: number | null; avg_deep_pct: number | null; nights: number | string }[];

  const out: Record<string, unknown> = { weekday: null, weekend: null };
  for (const r of rows) out[r.day_type] = r;
  return NextResponse.json(out);
}
