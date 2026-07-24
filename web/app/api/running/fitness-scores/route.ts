import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "edge";

/**
 * Endurance + hill fitness scores as JSON for the app running screen (the web
 * reads garmin_raw_data server-side). Mirrors getFitnessScores in
 * app/running/page.tsx.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = searchParams.get("range") || "1y";
  const days = range === "90d" ? 90 : range === "6m" ? 182 : range === "2y" ? 730 : 365;

  const sql = getDb();

  const endurance = (await sql`
    SELECT date::text as date,
      (raw_json->>'overallScore')::int  as score,
      (raw_json->>'classification')::int as classification
    FROM garmin_raw_data
    WHERE endpoint_name = 'endurance_score'
      AND date >= CURRENT_DATE - ${days}::int
    ORDER BY date ASC
  `) as { date: string; score: number | null; classification: number | null }[];

  const hill = (await sql`
    SELECT date::text as date,
      (raw_json->>'overallScore')::int   as score,
      (raw_json->>'strengthScore')::int  as strength,
      (raw_json->>'enduranceScore')::int as endurance
    FROM garmin_raw_data
    WHERE endpoint_name = 'hill_score'
      AND date >= CURRENT_DATE - ${days}::int
    ORDER BY date ASC
  `) as { date: string; score: number | null; strength: number | null; endurance: number | null }[];

  return NextResponse.json({
    endurance: { trend: endurance, latest: endurance.length ? endurance[endurance.length - 1] : null },
    hill: { trend: hill, latest: hill.length ? hill[hill.length - 1] : null },
  });
}
