import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const sql = getDb();
  const rows = await sql`
    SELECT DISTINCT ON (workout_name)
      workout_id, workout_name, sport_type, steps_summary, segments, synced_at
    FROM garmin_workouts
    ORDER BY workout_name, synced_at DESC
  `;
  return NextResponse.json(rows);
}
