import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Workout "insights" as JSON for the native app: the panels the web /workouts
 * page renders directly from SQL (no HTTP endpoint existed). Ports the page's
 * getTopExercises / getProgramSplit / getExercisePRs / getWorkoutHrTrend /
 * getMonthlyMuscleVolume / getTrainingCalendar queries. Weekly frequency and
 * training span are derived client-side from `calendar` to keep this lean.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = searchParams.get("range") || "90d";
  const days = range === "30d" ? 30 : range === "1y" ? 365 : range === "6m" ? 182 : 90;
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  const sql = getDb();

  const [topExercises, programSplit, prs, hrTrend, monthlyMuscle, calendar] = await Promise.all([
    // Top exercises (rich): count, best/avg weight, last performed, last-8 max weights
    sql`
      WITH base AS (
        SELECT e->>'title' as exercise,
          COUNT(DISTINCT raw_json->>'id') as workout_count,
          MAX((s->>'weight_kg')::float) as best_weight,
          ROUND(AVG((s->>'weight_kg')::float)::numeric, 1) as avg_weight,
          MAX((raw_json->>'start_time')::date) as last_performed
        FROM hevy_raw_data,
          jsonb_array_elements(raw_json->'exercises') as e,
          jsonb_array_elements(e->'sets') as s
        WHERE endpoint_name = 'workout'
          AND (raw_json->>'start_time')::timestamp >= ${cutoff}::date
          AND s->>'type' = 'normal' AND (s->>'weight_kg')::float > 0
        GROUP BY e->>'title' ORDER BY workout_count DESC LIMIT 10
      ),
      recent_w AS (
        SELECT e->>'title' as exercise, (raw_json->>'start_time')::date as wdate,
          MAX((s->>'weight_kg')::float) as max_weight
        FROM hevy_raw_data,
          jsonb_array_elements(raw_json->'exercises') as e,
          jsonb_array_elements(e->'sets') as s
        WHERE endpoint_name = 'workout'
          AND (raw_json->>'start_time')::timestamp >= ${cutoff}::date
          AND s->>'type' = 'normal' AND (s->>'weight_kg')::float > 0
          AND e->>'title' IN (SELECT exercise FROM base)
        GROUP BY e->>'title', wdate
      ),
      ranked AS (
        SELECT exercise, max_weight,
          ROW_NUMBER() OVER (PARTITION BY exercise ORDER BY wdate DESC) as rn
        FROM recent_w
      ),
      agg AS (
        SELECT exercise, array_agg(max_weight ORDER BY rn DESC) as recent_weights
        FROM ranked WHERE rn <= 8 GROUP BY exercise
      )
      SELECT b.*, COALESCE(a.recent_weights, ARRAY[]::float[]) as recent_weights
      FROM base b LEFT JOIN agg a ON a.exercise = b.exercise
      ORDER BY b.workout_count DESC
    `,
    // Program split
    sql`
      SELECT raw_json->>'title' as program, COUNT(*) as sessions,
        ROUND(AVG(EXTRACT(EPOCH FROM ((raw_json->>'end_time')::timestamp - (raw_json->>'start_time')::timestamp)) / 60)::numeric) as avg_duration
      FROM hevy_raw_data
      WHERE endpoint_name = 'workout'
        AND (raw_json->>'start_time')::timestamp >= ${cutoff}::date
      GROUP BY raw_json->>'title' ORDER BY sessions DESC LIMIT 6
    `,
    // Personal records (all-time, top 20 by max weight)
    sql`
      WITH all_sets AS (
        SELECT e->>'title' as exercise, (s->>'weight_kg')::float as weight, (s->>'reps')::int as reps
        FROM hevy_raw_data,
          jsonb_array_elements(raw_json->'exercises') as e,
          jsonb_array_elements(e->'sets') as s
        WHERE endpoint_name = 'workout' AND s->>'type' = 'normal' AND (s->>'weight_kg')::float > 0
      ),
      maxes AS (SELECT exercise, MAX(weight) as pr_weight FROM all_sets GROUP BY exercise HAVING MAX(weight) > 0)
      SELECT m.exercise, m.pr_weight, MAX(a.reps) as reps_at_pr
      FROM maxes m JOIN all_sets a ON a.exercise = m.exercise AND a.weight = m.pr_weight
      GROUP BY m.exercise, m.pr_weight ORDER BY m.pr_weight DESC LIMIT 20
    `,
    // Per-workout avg/max HR (enrichment)
    sql`
      SELECT (h.raw_json->>'start_time')::date as date, we.avg_hr, we.max_hr,
        h.raw_json->>'title' as title,
        ROUND(EXTRACT(EPOCH FROM ((h.raw_json->>'end_time')::timestamp - (h.raw_json->>'start_time')::timestamp)) / 60)::int as duration_min
      FROM hevy_raw_data h JOIN workout_enrichment we ON we.hevy_id = h.raw_json->>'id'
      WHERE h.endpoint_name = 'workout'
        AND (h.raw_json->>'start_time')::timestamp >= ${cutoff}::date
        AND we.avg_hr IS NOT NULL
      ORDER BY date ASC
    `,
    // Monthly volume by muscle group (6 groups via ILIKE CASE)
    sql`
      WITH exercise_muscles AS (
        SELECT TO_CHAR((raw_json->>'start_time')::timestamptz AT TIME ZONE 'America/New_York', 'YYYY-MM') as month,
          CASE
            WHEN e->>'title' ILIKE '%bench%' OR e->>'title' ILIKE '%chest%' OR e->>'title' ILIKE '%dip%' THEN 'Chest'
            WHEN e->>'title' ILIKE '%row%' OR e->>'title' ILIKE '%pull up%' OR e->>'title' ILIKE '%lat %' OR e->>'title' ILIKE '%deadlift%' OR e->>'title' ILIKE '%back extension%' THEN 'Back'
            WHEN e->>'title' ILIKE '%shoulder%' OR e->>'title' ILIKE '%overhead press%' OR e->>'title' ILIKE '%lateral raise%' OR e->>'title' ILIKE '%face pull%' OR e->>'title' ILIKE '%rear delt%' OR e->>'title' ILIKE '%reverse fly%' THEN 'Shoulders'
            WHEN e->>'title' ILIKE '%curl%' OR e->>'title' ILIKE '%hammer%' OR e->>'title' ILIKE '%preacher%' THEN 'Arms'
            WHEN e->>'title' ILIKE '%tricep%' OR e->>'title' ILIKE '%pushdown%' THEN 'Arms'
            WHEN e->>'title' ILIKE '%leg press%' OR e->>'title' ILIKE '%leg extension%' OR e->>'title' ILIKE '%squat%' OR e->>'title' ILIKE '%leg curl%' OR e->>'title' ILIKE '%romanian%' OR e->>'title' ILIKE '%hip%' THEN 'Legs'
            WHEN e->>'title' ILIKE '%calf%' THEN 'Legs'
            WHEN e->>'title' ILIKE '%crunch%' OR e->>'title' ILIKE '%plank%' OR e->>'title' ILIKE '%leg raise%' OR e->>'title' ILIKE '%side bend%' OR e->>'title' ILIKE '%russian twist%' OR e->>'title' ILIKE '%superman%' OR e->>'title' ILIKE '%torso%' THEN 'Core'
            ELSE NULL
          END as muscle_group,
          (s->>'weight_kg')::float * (s->>'reps')::int as volume
        FROM hevy_raw_data,
          jsonb_array_elements(raw_json->'exercises') as e,
          jsonb_array_elements(e->'sets') as s
        WHERE endpoint_name = 'workout'
          AND (raw_json->>'start_time')::timestamptz AT TIME ZONE 'America/New_York' >= ${cutoff}::date
          AND s->>'type' = 'normal' AND (s->>'weight_kg')::float > 0 AND (s->>'reps')::int > 0
      )
      SELECT month, muscle_group, ROUND(SUM(volume)::numeric) as volume
      FROM exercise_muscles WHERE muscle_group IS NOT NULL
      GROUP BY month, muscle_group ORDER BY month ASC, muscle_group
    `,
    // Training calendar — all workout days (all-time; drives heatmap + frequency + span)
    sql`
      SELECT ((raw_json->>'start_time')::timestamptz AT TIME ZONE 'America/New_York')::date as day,
        raw_json->>'title' as program
      FROM hevy_raw_data WHERE endpoint_name = 'workout' ORDER BY day ASC
    `,
  ]);

  return NextResponse.json({ topExercises, programSplit, prs, hrTrend, monthlyMuscle, calendar });
}
