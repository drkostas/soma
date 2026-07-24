import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "edge";

/**
 * HRV + training-readiness as JSON so the native app can render them (the web
 * reads garmin_raw_data server-side). Mirrors the hrv_data / training_readiness
 * queries in app/sleep/page.tsx.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = searchParams.get("range") || "30d";
  const days = range === "7d" ? 7 : range === "14d" ? 14 : range === "90d" ? 90 : range === "1y" ? 365 : 30;

  const sql = getDb();

  const hrv = (await sql`
    SELECT date,
      (raw_json->'hrvSummary'->>'weeklyAvg')::int    as weekly_avg,
      (raw_json->'hrvSummary'->>'lastNightAvg')::int as last_night_avg,
      raw_json->'hrvSummary'->>'status'              as status
    FROM garmin_raw_data
    WHERE endpoint_name = 'hrv_data'
      AND raw_json->'hrvSummary'->>'weeklyAvg' IS NOT NULL
      AND date >= CURRENT_DATE - ${days}::int
    ORDER BY date ASC
  `) as { date: string; weekly_avg: number | null; last_night_avg: number | null; status: string | null }[];

  const readiness = (await sql`
    SELECT date,
      (raw_json->0->>'score')::int                        as score,
      raw_json->0->>'level'                               as level,
      (raw_json->0->>'hrvFactorPercent')::int             as hrv_pct,
      (raw_json->0->>'stressHistoryFactorPercent')::int   as stress_pct,
      (raw_json->0->>'acwrFactorPercent')::int            as acwr_pct,
      (raw_json->0->>'recoveryTimeFactorPercent')::int    as recovery_pct,
      (raw_json->0->>'sleepHistoryFactorPercent')::int    as sleep_history_pct
    FROM garmin_raw_data
    WHERE endpoint_name = 'training_readiness'
      AND raw_json->0->>'score' IS NOT NULL
      AND date >= CURRENT_DATE - ${days}::int
    ORDER BY date ASC
  `) as {
    date: string; score: number | null; level: string | null;
    hrv_pct: number | null; stress_pct: number | null; acwr_pct: number | null;
    recovery_pct: number | null; sleep_history_pct: number | null;
  }[];

  return NextResponse.json({
    hrv: { trend: hrv, latest: hrv.length ? hrv[hrv.length - 1] : null },
    readiness: { trend: readiness, latest: readiness.length ? readiness[readiness.length - 1] : null },
  });
}
