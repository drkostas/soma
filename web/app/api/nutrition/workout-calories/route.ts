import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "edge";

export async function GET() {
  const sql = getDb();

  // Get average calories per routine title from last 5 sessions of each
  const rows = await sql`
    WITH ranked AS (
      SELECT
        hevy_title,
        calories,
        duration_s,
        ROW_NUMBER() OVER (PARTITION BY hevy_title ORDER BY workout_date DESC) as rn
      FROM workout_enrichment
      WHERE hevy_title IS NOT NULL AND calories IS NOT NULL AND calories > 0
    )
    SELECT
      hevy_title,
      ROUND(AVG(calories))::int AS avg_calories,
      ROUND(AVG(duration_s))::int AS avg_duration_s,
      COUNT(*)::int AS session_count
    FROM ranked
    WHERE rn <= 5
    GROUP BY hevy_title
    ORDER BY hevy_title
  `;

  return NextResponse.json({ routines: rows });
}
