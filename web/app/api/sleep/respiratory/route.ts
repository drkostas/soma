import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "edge";

/**
 * Blood-oxygen (SpO2) + respiration-rate trends as JSON for the app sleep screen
 * (the web reads garmin_raw_data server-side). Mirrors getSpO2Trend +
 * getRespirationTrend in app/sleep/page.tsx.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = searchParams.get("range") || "30d";
  const days = range === "7d" ? 7 : range === "14d" ? 14 : range === "90d" ? 90 : range === "1y" ? 365 : 30;

  const sql = getDb();

  // SpO2: combine sleep_data (historical) with spo2_data (recent, richer); spo2_data wins.
  const spo2 = (await sql`
    SELECT COALESCE(s.date, p.date)::text as date,
      COALESCE((p.raw_json->>'averageSpO2')::float, (s.raw_json->'dailySleepDTO'->>'averageSpO2Value')::float) as avg_spo2,
      COALESCE((p.raw_json->>'lowestSpO2')::int, (s.raw_json->'dailySleepDTO'->>'lowestSpO2Value')::int) as low_spo2,
      (p.raw_json->>'avgSleepSpO2')::float as sleep_spo2
    FROM garmin_raw_data s
    FULL OUTER JOIN garmin_raw_data p
      ON s.date = p.date AND p.endpoint_name = 'spo2_data' AND p.raw_json->>'averageSpO2' IS NOT NULL
      AND p.date >= CURRENT_DATE - ${days}::int
    WHERE s.endpoint_name = 'sleep_data'
      AND (s.raw_json->'dailySleepDTO'->>'sleepTimeSeconds')::int > 0
      AND s.date >= CURRENT_DATE - ${days}::int
      AND (s.raw_json->'dailySleepDTO'->>'averageSpO2Value' IS NOT NULL OR p.raw_json->>'averageSpO2' IS NOT NULL)
    ORDER BY 1 ASC
  `) as { date: string; avg_spo2: number | null; low_spo2: number | null; sleep_spo2: number | null }[];

  const respiration = (await sql`
    SELECT date::text as date,
      (raw_json->>'avgWakingRespirationValue')::float as awake_resp,
      (raw_json->>'avgSleepRespirationValue')::float  as sleep_resp,
      (raw_json->>'lowestRespirationValue')::float    as low_resp,
      (raw_json->>'highestRespirationValue')::float   as high_resp
    FROM garmin_raw_data
    WHERE endpoint_name = 'respiration_data'
      AND raw_json->>'avgWakingRespirationValue' IS NOT NULL
      AND date >= CURRENT_DATE - ${days}::int
    ORDER BY date ASC
  `) as { date: string; awake_resp: number | null; sleep_resp: number | null; low_resp: number | null; high_resp: number | null }[];

  return NextResponse.json({
    spo2: { trend: spo2, latest: spo2.length ? spo2[spo2.length - 1] : null },
    respiration: { trend: respiration, latest: respiration.length ? respiration[respiration.length - 1] : null },
  });
}
