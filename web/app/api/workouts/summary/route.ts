import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "edge";

/**
 * Strength-training data as JSON so the native app can render the workouts
 * dashboard (the web page reads hevy_raw_data server-side). Mirrors the queries
 * in app/workouts/page.tsx: weekly volume, summary stats, recent list, top exercises.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = searchParams.get("range") || "90d";
  const days = range === "30d" ? 30 : range === "1y" ? 365 : range === "6m" ? 182 : 90;

  const sql = getDb();

  // weekly training volume (normal sets: weight_kg * reps)
  const weeklyVolume = (await sql`
    WITH s AS (
      SELECT DATE_TRUNC('week', (raw_json->>'start_time')::timestamp)::date as week,
             (st->>'weight_kg')::float * (st->>'reps')::int as volume
      FROM hevy_raw_data,
        jsonb_array_elements(raw_json->'exercises') as e,
        jsonb_array_elements(e->'sets') as st
      WHERE endpoint_name = 'workout'
        AND (raw_json->>'start_time')::timestamp >= CURRENT_DATE - ${days}::int
        AND st->>'type' = 'normal'
        AND (st->>'weight_kg')::float > 0
        AND (st->>'reps')::int > 0
    )
    SELECT week, ROUND(SUM(volume)::numeric) as total_volume
    FROM s GROUP BY week ORDER BY week ASC
  `) as { week: string; total_volume: number }[];

  // summary stats over the window
  const statsRows = (await sql`
    SELECT COUNT(*) as total_workouts,
      COUNT(DISTINCT (raw_json->>'start_time')::date) as training_days,
      AVG(EXTRACT(EPOCH FROM ((raw_json->>'end_time')::timestamp - (raw_json->>'start_time')::timestamp)) / 60) as avg_duration_min,
      AVG(jsonb_array_length(raw_json->'exercises')) as avg_exercises
    FROM hevy_raw_data
    WHERE endpoint_name = 'workout'
      AND (raw_json->>'start_time')::timestamp >= CURRENT_DATE - ${days}::int
  `) as { total_workouts: number; training_days: number; avg_duration_min: number | null; avg_exercises: number | null }[];

  // recent workouts (with exercises to compute per-workout volume + top exercises)
  const recentRows = (await sql`
    SELECT raw_json->>'id' as id, raw_json->>'title' as title,
      raw_json->>'start_time' as start_time, raw_json->>'end_time' as end_time,
      jsonb_array_length(raw_json->'exercises') as exercise_count,
      raw_json->'exercises' as exercises
    FROM hevy_raw_data
    WHERE endpoint_name = 'workout'
      AND (raw_json->>'start_time')::timestamp >= CURRENT_DATE - ${days}::int
    ORDER BY (raw_json->>'start_time') DESC
    LIMIT 20
  `) as { id: string; title: string; start_time: string; end_time: string; exercise_count: number; exercises: unknown }[];

  type Ex = { title?: string; sets?: { type?: string; weight_kg?: number; reps?: number }[] };
  const exCount: Record<string, number> = {};
  const recent = recentRows.map((w) => {
    const exs: Ex[] = Array.isArray(w.exercises)
      ? (w.exercises as Ex[])
      : typeof w.exercises === "string"
      ? (JSON.parse(w.exercises) as Ex[])
      : [];
    let volume = 0;
    for (const e of exs) {
      if (e.title) exCount[e.title] = (exCount[e.title] ?? 0) + 1;
      for (const st of e.sets ?? []) {
        if (st.type === "normal" && (st.weight_kg ?? 0) > 0 && (st.reps ?? 0) > 0) {
          volume += (st.weight_kg as number) * (st.reps as number);
        }
      }
    }
    const durMin =
      w.start_time && w.end_time
        ? Math.round((new Date(w.end_time).getTime() - new Date(w.start_time).getTime()) / 60000)
        : null;
    return {
      id: w.id, title: w.title, start_time: w.start_time,
      exercise_count: w.exercise_count, duration_min: durMin, volume: Math.round(volume),
    };
  });

  const topExercises = Object.entries(exCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, sessions]) => ({ name, sessions }));

  return NextResponse.json({ stats: statsRows[0] ?? null, weeklyVolume, recent, topExercises });
}
