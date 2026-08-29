import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getExerciseMuscles, ALL_MUSCLE_GROUPS, type MuscleGroup } from "@/lib/muscle-groups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Metric = { primary: number; secondary: number; total: number };
type MetricMap = Record<MuscleGroup, Metric>;

const initMetric = (): MetricMap => {
  const r = {} as MetricMap;
  for (const mg of ALL_MUSCLE_GROUPS) r[mg] = { primary: 0, secondary: 0, total: 0 };
  return r;
};

/**
 * Per-muscle activation for the native Workouts body map. Ports the web
 * /workouts page's `getBodyMapVolumes`: aggregates each exercise's volume,
 * sets, reps and workout-session count onto its primary/secondary muscle
 * groups (secondary weighted 0.33), returning one map per metric so the app
 * can drive the anatomical figure + 4-metric toggle.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = searchParams.get("range") || "1y";
  const days = range === "30d" ? 30 : range === "90d" ? 90 : range === "6m" ? 182 : range === "all" ? 36500 : 365;
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  const sql = getDb();
  const rows = (await sql`
    SELECT
      e->>'title' as exercise,
      SUM((s->>'weight_kg')::float * (s->>'reps')::int) as volume,
      COUNT(*) as sets,
      SUM((s->>'reps')::int) as reps,
      COUNT(DISTINCT raw_json->>'id') as sessions
    FROM hevy_raw_data,
      jsonb_array_elements(raw_json->'exercises') as e,
      jsonb_array_elements(e->'sets') as s
    WHERE endpoint_name = 'workout'
      AND (raw_json->>'start_time')::timestamp >= ${cutoff}::date
      AND s->>'type' = 'normal'
      AND (s->>'weight_kg')::float > 0
      AND (s->>'reps')::int > 0
    GROUP BY e->>'title'
  `) as { exercise: string; volume: number; sets: number; reps: number; sessions: number }[];

  const volume = initMetric();
  const sets = initMetric();
  const reps = initMetric();
  const exercises = initMetric();

  for (const row of rows) {
    const mapping = getExerciseMuscles(String(row.exercise));
    const vals = { volume: Number(row.volume), sets: Number(row.sets), reps: Number(row.reps), exercises: Number(row.sessions) };
    for (const key of ["volume", "sets", "reps", "exercises"] as const) {
      const target = { volume, sets, reps, exercises }[key];
      const val = vals[key];
      for (const mg of mapping.primary) { target[mg].primary += val; target[mg].total += val; }
      for (const mg of mapping.secondary) { const c = val * 0.33; target[mg].secondary += c; target[mg].total += c; }
    }
  }

  return NextResponse.json({ volume, sets, reps, exercises });
}
