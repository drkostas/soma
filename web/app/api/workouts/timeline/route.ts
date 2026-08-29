import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Per-workout timelines for the native app's clickable summary-stat cards.
 * Ports the web /workouts page's `getWorkoutTimeline` (hevy_raw_data joined to
 * workout_enrichment) plus the four client-side series it derives
 * (cumulative count, duration/workout, calories/workout, workouts/month), so
 * each mobile stat card can open the same dated timeline the web modal shows.
 */
export async function GET() {
  const sql = getDb();

  const rows = (await sql`
    SELECT
      (h.raw_json->>'start_time')::date AS date,
      h.raw_json->>'title'              AS title,
      ROUND(EXTRACT(EPOCH FROM ((h.raw_json->>'end_time')::timestamp - (h.raw_json->>'start_time')::timestamp)) / 60)::int AS duration_min,
      we.calories
    FROM hevy_raw_data h
    LEFT JOIN workout_enrichment we ON we.hevy_id = h.raw_json->>'id'
    WHERE h.endpoint_name = 'workout'
    ORDER BY date ASC
  `) as { date: string | Date; title: string | null; duration_min: number | null; calories: number | null }[];

  const norm = (d: string | Date) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

  const cumulative = rows.map((w, i) => ({ date: norm(w.date), value: i + 1, label: `#${i + 1}: ${w.title ?? "Workout"}` }));
  const duration = rows
    .filter((w) => (w.duration_min ?? 0) > 0)
    .map((w) => ({ date: norm(w.date), value: Number(w.duration_min), label: w.title ?? "Workout" }));
  const calories = rows
    .filter((w) => w.calories != null)
    .map((w) => ({ date: norm(w.date), value: Number(w.calories), label: w.title ?? "Workout" }));

  const monthlyMap = new Map<string, number>();
  for (const w of rows) {
    const month = norm(w.date).slice(0, 7);
    monthlyMap.set(month, (monthlyMap.get(month) || 0) + 1);
  }
  const monthly = [...monthlyMap.entries()]
    .sort()
    .map(([month, count]) => ({ date: month + "-01", value: count }));

  return NextResponse.json({ cumulative, duration, calories, monthly });
}
