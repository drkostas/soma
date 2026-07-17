import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "edge";

/**
 * hevy2garmin sync status — recent Hevy workouts and their Garmin sync state,
 * read from the soma DB (workout_enrichment is populated by the TS hevy-sync
 * cron). Consumed by the hevy2garmin universal app.
 */
export async function GET() {
  const sql = getDb();

  const recent = await sql`
    SELECT hevy_title, workout_date, calories, exercise_count, total_sets,
           garmin_activity_id, status
    FROM workout_enrichment
    ORDER BY workout_date DESC
    LIMIT 8
  `;

  const counts = await sql`
    SELECT count(*)::int AS total,
           count(garmin_activity_id)::int AS synced,
           count(*) FILTER (WHERE workout_date >= (now()::date - 7))::int AS week
    FROM workout_enrichment
  `;

  return NextResponse.json({
    hevyConnected: recent.length > 0,
    garminConnected: recent.some((r) => r.garmin_activity_id != null),
    totalSynced: counts[0]?.synced ?? 0,
    syncedThisWeek: counts[0]?.week ?? 0,
    recent: recent.map((r) => ({
      title: r.hevy_title as string,
      date: r.workout_date as string,
      kcal: Number(r.calories) || 0,
      exercises: Number(r.exercise_count) || 0,
      sets: Number(r.total_sets) || 0,
      synced: r.garmin_activity_id != null,
      status: r.status as string,
    })),
  });
}
