import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExpandableChartCard } from "@/components/expandable-chart-card";
import { getDb } from "@/lib/db";
import { VolumeChart } from "@/components/volume-chart";
import { ExpandableStrengthChart } from "@/components/expandable-strength-chart";
import { WorkoutHrTrendChart } from "@/components/workout-hr-trend-chart";
import { ExerciseHrChart } from "@/components/exercise-hr-chart";
import { MuscleGroupHrChart } from "@/components/muscle-group-hr-chart";
import { ClickableWorkoutList } from "@/components/clickable-workout-list";
import { ClickableWeeklyFrequency } from "@/components/clickable-weekly-frequency";
import { ClickableSummaryStats } from "@/components/clickable-summary-stats";
import { WorkoutCalendar } from "@/components/workout-calendar";
import { MuscleVolumeDistribution } from "@/components/muscle-volume-distribution";
import { MuscleBodyMapSection } from "@/components/muscle-body-map-section";
import { ClickableTopExercises } from "@/components/clickable-top-exercises";
import { ClickablePersonalRecords } from "@/components/clickable-personal-records";
import { TimeRangeSelector } from "@/components/time-range-selector";
import { rangeToDays } from "@/lib/time-ranges";
import { getExerciseMuscles, ALL_MUSCLE_GROUPS, type MuscleGroup } from "@/lib/muscle-groups";
import {
  Dumbbell,
  Clock,
  TrendingUp,
  Flame,
  Calendar,
  Target,
  HeartPulse,
  Heart,
} from "lucide-react";

export const revalidate = 300;

async function getRecentWorkouts(cutoff: string, limit = 20) {
  const sql = getDb();
  const rows = await sql`
    SELECT
      h.raw_json->>'id' as id,
      h.raw_json->>'title' as title,
      h.raw_json->>'start_time' as start_time,
      h.raw_json->>'end_time' as end_time,
      jsonb_array_length(h.raw_json->'exercises') as exercise_count,
      h.raw_json->'exercises' as exercises,
      we.avg_hr,
      we.max_hr,
      we.calories as garmin_calories
    FROM hevy_raw_data h
    LEFT JOIN workout_enrichment we ON we.hevy_id = h.raw_json->>'id'
    WHERE h.endpoint_name = 'workout'
      AND (h.raw_json->>'start_time')::timestamp >= ${cutoff}::date
    ORDER BY h.raw_json->>'start_time' DESC
    LIMIT ${limit}
  `;
  return rows;
}

async function getWorkoutCount() {
  const sql = getDb();
  const rows = await sql`
    SELECT COUNT(*) as total
    FROM hevy_raw_data
    WHERE endpoint_name = 'workout'
  `;
  return Number(rows[0]?.total ?? 0);
}

async function getWeeklyVolume(cutoff: string) {
  const sql = getDb();
  const rows = await sql`
    WITH workout_sets AS (
      SELECT
        DATE_TRUNC('week', (raw_json->>'start_time')::timestamp)::date as week,
        (s->>'weight_kg')::float * (s->>'reps')::int as volume
      FROM hevy_raw_data,
        jsonb_array_elements(raw_json->'exercises') as e,
        jsonb_array_elements(e->'sets') as s
      WHERE endpoint_name = 'workout'
        AND (raw_json->>'start_time')::timestamp >= ${cutoff}::date
        AND s->>'type' = 'normal'
        AND (s->>'weight_kg')::float > 0
        AND (s->>'reps')::int > 0
    )
    SELECT week, ROUND(SUM(volume)::numeric) as total_volume
    FROM workout_sets
    GROUP BY week
    ORDER BY week ASC
  `;
  return rows;
}

async function getWorkoutSummaryStats() {
  const sql = getDb();
  const rows = await sql`
    WITH stats AS (
      SELECT
        COUNT(*) as total_workouts,
        COUNT(DISTINCT (raw_json->>'start_time')::date) as training_days,
        AVG(EXTRACT(EPOCH FROM ((raw_json->>'end_time')::timestamp - (raw_json->>'start_time')::timestamp)) / 60) as avg_duration_min,
        AVG(jsonb_array_length(raw_json->'exercises')) as avg_exercises,
        MIN((raw_json->>'start_time')::date) as first_workout,
        MAX((raw_json->>'start_time')::date) as last_workout
      FROM hevy_raw_data
      WHERE endpoint_name = 'workout'
    )
    SELECT * FROM stats
  `;
  return rows[0];
}

async function getGarminCalorieStats(cutoff: string) {
  const sql = getDb();
  const rows = await sql`
    SELECT
      COUNT(*) as total,
      COUNT(we.calories) as matched,
      ROUND(AVG(we.calories)::numeric) as avg_calories
    FROM hevy_raw_data h
    LEFT JOIN workout_enrichment we ON we.hevy_id = h.raw_json->>'id'
    WHERE h.endpoint_name = 'workout'
      AND (h.raw_json->>'start_time')::timestamp >= ${cutoff}::date
  `;
  return rows[0];
}

async function getTopExercises(cutoff: string) {
  const sql = getDb();
  const rows = await sql`
    SELECT
      e->>'title' as exercise,
      COUNT(DISTINCT raw_json->>'id') as workout_count,
      MAX((s->>'weight_kg')::float) as best_weight,
      ROUND(AVG((s->>'weight_kg')::float)::numeric, 1) as avg_weight
    FROM hevy_raw_data,
      jsonb_array_elements(raw_json->'exercises') as e,
      jsonb_array_elements(e->'sets') as s
    WHERE endpoint_name = 'workout'
      AND (raw_json->>'start_time')::timestamp >= ${cutoff}::date
      AND s->>'type' = 'normal'
      AND (s->>'weight_kg')::float > 0
    GROUP BY e->>'title'
    ORDER BY workout_count DESC
    LIMIT 10
  `;
  return rows;
}

async function getProgramSplit(cutoff: string) {
  const sql = getDb();
  const rows = await sql`
    SELECT
      raw_json->>'title' as program,
      COUNT(*) as sessions,
      ROUND(AVG(EXTRACT(EPOCH FROM ((raw_json->>'end_time')::timestamp - (raw_json->>'start_time')::timestamp)) / 60)::numeric) as avg_duration
    FROM hevy_raw_data
    WHERE endpoint_name = 'workout'
      AND (raw_json->>'start_time')::timestamp >= ${cutoff}::date
    GROUP BY raw_json->>'title'
    ORDER BY sessions DESC
    LIMIT 6
  `;
  return rows;
}

async function getExercisePRs() {
  const sql = getDb();
  const rows = await sql`
    WITH all_sets AS (
      SELECT
        e->>'title' as exercise,
        (s->>'weight_kg')::float as weight,
        (s->>'reps')::int as reps
      FROM hevy_raw_data,
        jsonb_array_elements(raw_json->'exercises') as e,
        jsonb_array_elements(e->'sets') as s
      WHERE endpoint_name = 'workout'
        AND s->>'type' = 'normal'
        AND (s->>'weight_kg')::float > 0
    ),
    maxes AS (
      SELECT exercise, MAX(weight) as pr_weight
      FROM all_sets
      GROUP BY exercise
      HAVING MAX(weight) > 0
    )
    SELECT m.exercise, m.pr_weight, MAX(a.reps) as reps_at_pr
    FROM maxes m
    JOIN all_sets a ON a.exercise = m.exercise AND a.weight = m.pr_weight
    GROUP BY m.exercise, m.pr_weight
    ORDER BY m.pr_weight DESC
    LIMIT 20
  `;
  return rows;
}

async function getMuscleGroupVolume(cutoff: string) {
  const sql = getDb();
  // Map exercise titles to muscle groups since Hevy workout data doesn't include muscle_group
  const rows = await sql`
    WITH exercise_muscles AS (
      SELECT
        e->>'title' as exercise,
        CASE
          WHEN e->>'title' ILIKE '%bench%' OR e->>'title' ILIKE '%chest%' OR e->>'title' ILIKE '%dip%' THEN 'chest'
          WHEN e->>'title' ILIKE '%row%' OR e->>'title' ILIKE '%pull up%' OR e->>'title' ILIKE '%lat %' OR e->>'title' ILIKE '%deadlift%' OR e->>'title' ILIKE '%back extension%' THEN 'back'
          WHEN e->>'title' ILIKE '%shoulder%' OR e->>'title' ILIKE '%overhead press%' OR e->>'title' ILIKE '%lateral raise%' OR e->>'title' ILIKE '%front raise%' OR e->>'title' ILIKE '%face pull%' OR e->>'title' ILIKE '%rear delt%' OR e->>'title' ILIKE '%reverse fly%' THEN 'shoulders'
          WHEN e->>'title' ILIKE '%curl%' OR e->>'title' ILIKE '%hammer%' OR e->>'title' ILIKE '%preacher%' OR e->>'title' ILIKE '%concentration%' THEN 'biceps'
          WHEN e->>'title' ILIKE '%tricep%' OR e->>'title' ILIKE '%pushdown%' THEN 'triceps'
          WHEN e->>'title' ILIKE '%leg press%' OR e->>'title' ILIKE '%leg extension%' OR e->>'title' ILIKE '%squat%' OR e->>'title' ILIKE '%leg curl%' OR e->>'title' ILIKE '%romanian%' OR e->>'title' ILIKE '%hip%' THEN 'legs'
          WHEN e->>'title' ILIKE '%calf%' THEN 'calves'
          WHEN e->>'title' ILIKE '%crunch%' OR e->>'title' ILIKE '%plank%' OR e->>'title' ILIKE '%leg raise%' OR e->>'title' ILIKE '%side bend%' OR e->>'title' ILIKE '%russian twist%' OR e->>'title' ILIKE '%superman%' OR e->>'title' ILIKE '%torso%' THEN 'core'
          WHEN e->>'title' ILIKE '%wrist%' THEN 'forearms'
          ELSE 'other'
        END as muscle_group,
        s
      FROM hevy_raw_data,
        jsonb_array_elements(raw_json->'exercises') as e,
        jsonb_array_elements(e->'sets') as s
      WHERE endpoint_name = 'workout'
        AND (raw_json->>'start_time')::timestamp >= ${cutoff}::date
        AND s->>'type' = 'normal'
        AND (s->>'weight_kg')::float > 0
        AND (s->>'reps')::int > 0
    )
    SELECT
      muscle_group,
      COUNT(*) as total_sets,
      SUM((s->>'reps')::int) as total_reps,
      COUNT(DISTINCT exercise) as exercise_count,
      ROUND(SUM((s->>'weight_kg')::float * (s->>'reps')::int)::numeric) as total_volume
    FROM exercise_muscles
    WHERE muscle_group != 'other'
    GROUP BY muscle_group
    ORDER BY total_volume DESC
  `;
  return rows;
}

async function getBodyMapVolumes(cutoff: string) {
  const sql = getDb();
  // Get per-exercise metrics: volume, sets, reps, workout sessions
  const rows = await sql`
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
  `;

  // Map to muscle groups for each metric
  type Metric = { primary: number; secondary: number; total: number };
  const initMetric = (): Record<string, Metric> => {
    const r: Record<string, Metric> = {};
    for (const mg of ALL_MUSCLE_GROUPS) r[mg] = { primary: 0, secondary: 0, total: 0 };
    return r;
  };
  const volume = initMetric();
  const sets = initMetric();
  const reps = initMetric();
  const exercises = initMetric();

  for (const row of rows) {
    const mapping = getExerciseMuscles(String(row.exercise));
    const vals = {
      volume: Number(row.volume),
      sets: Number(row.sets),
      reps: Number(row.reps),
      exercises: Number(row.sessions), // workout sessions, not distinct exercise types
    };

    for (const metricKey of ["volume", "sets", "reps", "exercises"] as const) {
      const target = { volume, sets, reps, exercises }[metricKey];
      const val = vals[metricKey];
      for (const mg of mapping.primary) {
        target[mg].primary += val;
        target[mg].total += val;
      }
      for (const mg of mapping.secondary) {
        // For countable metrics (sets/reps/exercises), secondary still uses 0.33 weighting
        // For volume, same 0.33 factor
        const contrib = val * 0.33;
        target[mg].secondary += contrib;
        target[mg].total += contrib;
      }
    }
  }

  return { volume, sets, reps, exercises };
}

async function getWorkoutHrTrend(cutoff: string) {
  const sql = getDb();
  const rows = await sql`
    SELECT
      (h.raw_json->>'start_time')::date as date,
      we.avg_hr,
      we.max_hr,
      h.raw_json->>'title' as title,
      ROUND(EXTRACT(EPOCH FROM ((h.raw_json->>'end_time')::timestamp - (h.raw_json->>'start_time')::timestamp)) / 60)::int as duration_min
    FROM hevy_raw_data h
    JOIN workout_enrichment we ON we.hevy_id = h.raw_json->>'id'
    WHERE h.endpoint_name = 'workout'
      AND (h.raw_json->>'start_time')::timestamp >= ${cutoff}::date
      AND we.avg_hr IS NOT NULL
    ORDER BY date ASC
  `;
  return rows;
}

async function getExerciseAvgHr(cutoff: string) {
  const sql = getDb();
  const rows = await sql`
    WITH exercise_hr AS (
      SELECT
        e->>'title' as exercise,
        we.avg_hr,
        we.max_hr
      FROM hevy_raw_data h
      JOIN workout_enrichment we ON we.hevy_id = h.raw_json->>'id'
      CROSS JOIN jsonb_array_elements(h.raw_json->'exercises') as e
      WHERE h.endpoint_name = 'workout'
        AND (h.raw_json->>'start_time')::timestamp >= ${cutoff}::date
        AND we.avg_hr IS NOT NULL
    )
    SELECT
      exercise,
      ROUND(AVG(avg_hr)::numeric) as avg_hr,
      ROUND(MAX(max_hr)::numeric) as max_hr,
      COUNT(*) as session_count
    FROM exercise_hr
    GROUP BY exercise
    HAVING COUNT(*) >= 3
    ORDER BY avg_hr DESC
    LIMIT 15
  `;
  return rows;
}

async function getExerciseHrDetail(cutoff: string) {
  const sql = getDb();
  // Per-workout HR data for each exercise (for per-exercise HR trends)
  const rows = await sql`
    SELECT
      e->>'title' as exercise,
      (h.raw_json->>'start_time')::date as workout_date,
      we.avg_hr,
      we.max_hr
    FROM hevy_raw_data h
    JOIN workout_enrichment we ON we.hevy_id = h.raw_json->>'id'
    CROSS JOIN jsonb_array_elements(h.raw_json->'exercises') as e
    WHERE h.endpoint_name = 'workout'
      AND (h.raw_json->>'start_time')::timestamp >= ${cutoff}::date
      AND we.avg_hr IS NOT NULL
    ORDER BY workout_date ASC
  `;
  return rows;
}

async function getConfigurableProgression(cutoff: string) {
  const sql = getDb();
  // Get top 15 most frequent exercises with weight data
  const exercises = await sql`
    SELECT
      e->>'title' as exercise,
      COUNT(DISTINCT raw_json->>'id') as count
    FROM hevy_raw_data,
      jsonb_array_elements(raw_json->'exercises') as e,
      jsonb_array_elements(e->'sets') as s
    WHERE endpoint_name = 'workout'
      AND (raw_json->>'start_time')::timestamp >= ${cutoff}::date
      AND s->>'type' = 'normal'
      AND (s->>'weight_kg')::float > 0
    GROUP BY e->>'title'
    ORDER BY count DESC
    LIMIT 15
  `;

  const exerciseNames = exercises.map((e: any) => String(e.exercise));
  if (exerciseNames.length === 0) return { exercises: [], progression: [] };

  // Get progression for those exercises
  const progression = await sql`
    SELECT
      e->>'title' as exercise,
      (raw_json->>'start_time')::date as workout_date,
      MAX((s->>'weight_kg')::float) as max_weight
    FROM hevy_raw_data,
      jsonb_array_elements(raw_json->'exercises') as e,
      jsonb_array_elements(e->'sets') as s
    WHERE endpoint_name = 'workout'
      AND (raw_json->>'start_time')::timestamp >= ${cutoff}::date
      AND s->>'type' = 'normal'
      AND (s->>'weight_kg')::float > 0
      AND e->>'title' = ANY(${exerciseNames})
    GROUP BY e->>'title', workout_date
    ORDER BY workout_date ASC
  `;

  return {
    exercises: exercises.map((e: any) => ({ exercise: String(e.exercise), count: Number(e.count) })),
    progression,
  };
}

async function getWorkoutFrequencyByWeekDetailed(cutoff: string) {
  const sql = getDb();
  // Get weekly frequency with per-workout details for clickable bars
  const rows = await sql`
    SELECT
      DATE_TRUNC('week', (raw_json->>'start_time')::timestamp)::date as week,
      raw_json->>'title' as title,
      (raw_json->>'start_time')::date as date,
      ROUND(EXTRACT(EPOCH FROM ((raw_json->>'end_time')::timestamp - (raw_json->>'start_time')::timestamp)) / 60)::int as duration_min,
      (SELECT jsonb_agg(e->>'title') FROM jsonb_array_elements(raw_json->'exercises') as e) as exercise_titles
    FROM hevy_raw_data
    WHERE endpoint_name = 'workout'
      AND (raw_json->>'start_time')::timestamp >= ${cutoff}::date
    ORDER BY date ASC
  `;
  // Group by week
  const weekMap = new Map<string, { week: string; workouts: number; avg_duration: number; details: any[] }>();
  for (const r of rows) {
    const weekStr = r.week instanceof Date ? r.week.toISOString().split("T")[0] : String(r.week).slice(0, 10);
    const dateStr = r.date instanceof Date ? r.date.toISOString().split("T")[0] : String(r.date).slice(0, 10);
    if (!weekMap.has(weekStr)) {
      weekMap.set(weekStr, { week: weekStr, workouts: 0, avg_duration: 0, details: [] });
    }
    const w = weekMap.get(weekStr)!;
    w.workouts++;
    const exercises = typeof r.exercise_titles === "string" ? JSON.parse(r.exercise_titles) : (r.exercise_titles || []);
    w.details.push({
      title: r.title,
      date: dateStr,
      exercises: exercises,
      duration_min: Number(r.duration_min),
    });
  }
  // Compute avg duration
  for (const w of weekMap.values()) {
    w.avg_duration = Math.round(w.details.reduce((s: number, d: any) => s + d.duration_min, 0) / w.details.length);
  }
  return Array.from(weekMap.values()).sort((a, b) => a.week.localeCompare(b.week));
}

async function getWorkoutTimeline() {
  const sql = getDb();
  // Get per-workout data for summary stat timelines
  const rows = await sql`
    SELECT
      (h.raw_json->>'start_time')::date as date,
      h.raw_json->>'title' as title,
      ROUND(EXTRACT(EPOCH FROM ((h.raw_json->>'end_time')::timestamp - (h.raw_json->>'start_time')::timestamp)) / 60)::int as duration_min,
      we.calories,
      we.avg_hr
    FROM hevy_raw_data h
    LEFT JOIN workout_enrichment we ON we.hevy_id = h.raw_json->>'id'
    WHERE h.endpoint_name = 'workout'
    ORDER BY date ASC
  `;
  return rows;
}

async function getMonthlyMuscleVolume(cutoff: string) {
  const sql = getDb();
  // Use AT TIME ZONE to avoid UTC→local month boundary shifts
  const rows = await sql`
    WITH exercise_muscles AS (
      SELECT
        TO_CHAR((raw_json->>'start_time')::timestamptz AT TIME ZONE 'America/New_York', 'YYYY-MM') as month,
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
        AND s->>'type' = 'normal'
        AND (s->>'weight_kg')::float > 0
        AND (s->>'reps')::int > 0
    )
    SELECT
      month,
      muscle_group,
      ROUND(SUM(volume)::numeric) as volume
    FROM exercise_muscles
    WHERE muscle_group IS NOT NULL
    GROUP BY month, muscle_group
    ORDER BY month ASC, muscle_group
  `;
  return rows;
}

async function getTrainingCalendar() {
  const sql = getDb();
  // Fetch all workout dates (no cutoff) so the calendar can navigate to any period
  const rows = await sql`
    SELECT
      ((raw_json->>'start_time')::timestamptz AT TIME ZONE 'America/New_York')::date as day,
      raw_json->>'title' as program,
      raw_json->>'id' as hevy_id
    FROM hevy_raw_data
    WHERE endpoint_name = 'workout'
    ORDER BY day ASC
  `;
  return rows;
}

function formatDuration(startTime: string, endTime: string): string {
  const ms = new Date(endTime).getTime() - new Date(startTime).getTime();
  const min = Math.round(ms / 60000);
  if (min >= 60) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${h}h ${m}m`;
  }
  return `${min}m`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "2-digit" }),
  });
}

function getWorkingSets(exercises: any[]): { totalSets: number; totalVolume: number } {
  let totalSets = 0;
  let totalVolume = 0;
  for (const ex of exercises) {
    const sets = Array.isArray(ex.sets) ? ex.sets : [];
    for (const s of sets) {
      if (s.type === "normal" && s.weight_kg > 0 && s.reps > 0) {
        totalSets++;
        totalVolume += s.weight_kg * s.reps;
      }
    }
  }
  return { totalSets, totalVolume };
}

export default async function WorkoutsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const params = await searchParams;
  const rangeDays = rangeToDays(params.range);
  const cutoff = new Date(Date.now() - rangeDays * 86400000).toISOString().split("T")[0];
  const [recent, weeklyVolume, configurableProgression, stats, topExercises, programSplit, exercisePRs, calendar, muscleGroups, weeklyFreqDetailed, monthlyMuscle, calorieStats, totalWorkoutCount, bodyMapVolumes, hrTrend, exerciseHr, exerciseHrDetail, workoutTimeline] =
    await Promise.all([
      getRecentWorkouts(cutoff, 50),
      getWeeklyVolume(cutoff),
      getConfigurableProgression(cutoff),
      getWorkoutSummaryStats(),
      getTopExercises(cutoff),
      getProgramSplit(cutoff),
      getExercisePRs(),
      getTrainingCalendar(),
      getMuscleGroupVolume(cutoff),
      getWorkoutFrequencyByWeekDetailed(cutoff),
      getMonthlyMuscleVolume(cutoff),
      getGarminCalorieStats(cutoff),
      getWorkoutCount(),
      getBodyMapVolumes(cutoff),
      getWorkoutHrTrend(cutoff),
      getExerciseAvgHr(cutoff),
      getExerciseHrDetail(cutoff),
      getWorkoutTimeline(),
    ]);

  const totalWeeks = stats
    ? Math.ceil(
        (new Date(stats.last_workout).getTime() - new Date(stats.first_workout).getTime()) /
          (7 * 24 * 60 * 60 * 1000)
      )
    : 0;
  const avgPerWeek = totalWeeks > 0 ? (Number(stats.total_workouts) / totalWeeks).toFixed(1) : "—";

  // Compute timeline data for clickable summary stats
  const normalizeDate = (d: any) => d instanceof Date ? d.toISOString().split("T")[0] : String(d).slice(0, 10);
  const durationTimeline = (workoutTimeline as any[])
    .filter((w: any) => w.duration_min > 0)
    .map((w: any) => ({ date: normalizeDate(w.date), value: Number(w.duration_min), label: String(w.title) }));
  const caloriesTimeline = (workoutTimeline as any[])
    .filter((w: any) => w.calories != null)
    .map((w: any) => ({ date: normalizeDate(w.date), value: Number(w.calories), label: String(w.title) }));
  const cumulativeTimeline = (workoutTimeline as any[]).map((w: any, i: number) => ({
    date: normalizeDate(w.date), value: i + 1, label: `#${i + 1}: ${String(w.title)}`,
  }));
  const monthlyCountMap = new Map<string, number>();
  for (const w of workoutTimeline as any[]) {
    const month = normalizeDate(w.date).slice(0, 7);
    monthlyCountMap.set(month, (monthlyCountMap.get(month) || 0) + 1);
  }
  const monthlyCountTimeline = Array.from(monthlyCountMap.entries())
    .sort()
    .map(([month, count]) => ({ date: month + "-01", value: count }));

  return (
    <div className="container mx-auto px-6 py-8 max-w-7xl">
      {/* Header */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Workouts</h1>
          <p className="text-muted-foreground mt-1">
            Training history and progression
          </p>
        </div>
        <TimeRangeSelector />
      </div>

      {/* Summary Stats (clickable with timelines) */}
      <ClickableSummaryStats stats={[
        {
          label: "Total Workouts",
          value: String(Number(stats?.total_workouts ?? 0)),
          subtitle: `${avgPerWeek}/week avg`,
          icon: <Dumbbell className="h-4 w-4 text-primary" />,
          timelineData: cumulativeTimeline,
          timelineLabel: "Cumulative Workout Count",
          timelineUnit: "workouts",
        },
        {
          label: "Avg Duration",
          value: stats?.avg_duration_min ? `${Math.round(Number(stats.avg_duration_min))}m` : "—",
          subtitle: `~${stats?.avg_exercises ? Math.round(Number(stats.avg_exercises)) : "—"} exercises/session`,
          icon: <Clock className="h-4 w-4 text-blue-400" />,
          timelineData: durationTimeline,
          timelineLabel: "Duration Per Workout",
          timelineUnit: "min",
        },
        {
          label: "Training Span",
          value: `${totalWeeks} weeks`,
          subtitle: `${stats?.first_workout ? formatDate(stats.first_workout) : "—"} → now`,
          icon: <Calendar className="h-4 w-4 text-green-400" />,
          timelineData: monthlyCountTimeline,
          timelineLabel: "Workouts Per Month",
          timelineUnit: "workouts",
        },
        {
          label: "Avg Calories",
          value: calorieStats?.avg_calories ? `${Number(calorieStats.avg_calories)} kcal` : "—",
          subtitle: calorieStats?.matched && calorieStats?.total
            ? `${Number(calorieStats.matched)} of ${Number(calorieStats.total)} matched`
            : "via Garmin HR",
          icon: <HeartPulse className="h-4 w-4 text-red-400" />,
          timelineData: caloriesTimeline,
          timelineLabel: "Calories Per Workout",
          timelineUnit: "kcal",
        },
      ]} />

      {/* Muscle Body Map + Charts Row */}
      <MuscleBodyMapSection allMetrics={bodyMapVolumes as any} />

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <ExpandableChartCard title="Weekly Volume (kg)" icon={<Flame className="h-4 w-4 text-orange-400" />}>
          <VolumeChart data={(() => {
            const vols = weeklyVolume as any[];
            if (vols.length <= 52) return vols;
            const recent = vols.slice(-52);
            const sorted = [...recent].sort((a, b) => Number(a.total_volume) - Number(b.total_volume));
            const median = Number(sorted[Math.floor(sorted.length / 2)]?.total_volume || 0);
            const cap = median * 3;
            return recent.map(v => ({
              ...v,
              total_volume: Math.min(Number(v.total_volume), cap),
            }));
          })()} />
        </ExpandableChartCard>

        <ExpandableStrengthChart
          data={(configurableProgression as any).progression || []}
          availableExercises={(configurableProgression as any).exercises || []}
        />
      </div>

      {/* Weekly Workout Frequency (clickable) */}
      {(weeklyFreqDetailed as any[]).length > 0 && (
        <ClickableWeeklyFrequency data={weeklyFreqDetailed as any} />
      )}

      {/* Heart Rate Analysis */}
      {((hrTrend as any[]).length > 0 || (exerciseHr as any[]).length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <ExpandableChartCard title="Avg Heart Rate per Workout" icon={<Heart className="h-4 w-4 text-red-400" />}>
            <WorkoutHrTrendChart data={(hrTrend as any[]).map((r: any) => ({
              date: normalizeDate(r.date),
              avg_hr: Number(r.avg_hr),
              max_hr: Number(r.max_hr),
              title: String(r.title),
              duration_min: Number(r.duration_min),
            }))} />
          </ExpandableChartCard>
          <ExpandableChartCard title="Avg Heart Rate by Exercise" icon={<Heart className="h-4 w-4 text-red-400" />} subtitle="Click exercise for trend">
            <ExerciseHrChart
              data={(exerciseHr as any[]).map((r: any) => ({
                exercise: String(r.exercise),
                avg_hr: Number(r.avg_hr),
                max_hr: Number(r.max_hr),
                session_count: Number(r.session_count),
              }))}
              detail={(exerciseHrDetail as any[]).map((r: any) => ({
                exercise: String(r.exercise),
                workout_date: normalizeDate(r.workout_date),
                avg_hr: Number(r.avg_hr),
                max_hr: Number(r.max_hr),
              }))}
            />
          </ExpandableChartCard>
          <ExpandableChartCard title="Heart Rate by Muscle Group" icon={<Heart className="h-4 w-4 text-red-400" />}>
            <MuscleGroupHrChart data={(exerciseHrDetail as any[]).map((r: any) => ({
              exercise: String(r.exercise),
              workout_date: normalizeDate(r.workout_date),
              avg_hr: Number(r.avg_hr),
              max_hr: Number(r.max_hr),
            }))} />
          </ExpandableChartCard>
        </div>
      )}

      {/* Muscle Group Distribution */}
      {muscleGroups.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Target className="h-4 w-4 text-purple-400" />
              Muscle Group Volume Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            <MuscleVolumeDistribution data={muscleGroups as any} />
          </CardContent>
        </Card>
      )}

      {/* Monthly Volume by Muscle Group */}
      {(monthlyMuscle as any[]).length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-400" />
              Monthly Volume by Muscle Group
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const mgColors: Record<string, string> = {
                Chest: "bg-red-500", Back: "bg-green-500", Shoulders: "bg-orange-500",
                Arms: "bg-cyan-500", Legs: "bg-blue-500", Core: "bg-yellow-500",
              };
              const monthMap = new Map<string, Map<string, number>>();
              const allGroups = new Set<string>();
              for (const r of monthlyMuscle as any[]) {
                if (!monthMap.has(r.month)) monthMap.set(r.month, new Map());
                monthMap.get(r.month)!.set(r.muscle_group, Number(r.volume));
                allGroups.add(r.muscle_group);
              }
              const months = Array.from(monthMap.keys()).sort().slice(-12);
              const groups = ["Legs", "Back", "Chest", "Shoulders", "Arms", "Core"].filter(g => allGroups.has(g));

              // Find max total for scaling
              const maxTotal = Math.max(...months.map(m => {
                const mg = monthMap.get(m)!;
                return Array.from(mg.values()).reduce((s, v) => s + v, 0);
              }));

              const BAR_HEIGHT = 140;
              return (
                <div>
                  <div className="flex items-end gap-[4px]" style={{ height: `${BAR_HEIGHT + 20}px` }}>
                    {months.map((month) => {
                      const mg = monthMap.get(month)!;
                      const total = Array.from(mg.values()).reduce((s, v) => s + v, 0);
                      const barH = maxTotal > 0 ? (total / maxTotal) * BAR_HEIGHT : 0;
                      const monthDate = new Date(month + "-01");
                      const label = monthDate.toLocaleDateString("en-US", { month: "short" });

                      return (
                        <div key={month} className="flex-1 flex flex-col items-center justify-end">
                          <div className="w-full flex flex-col rounded-t-sm overflow-hidden" style={{ height: `${Math.max(barH, 3)}px` }}>
                            {groups.map((g) => {
                              const vol = mg.get(g) || 0;
                              const volPct = total > 0 ? (vol / total) * 100 : 0;
                              if (volPct < 1) return null;
                              return (
                                <div
                                  key={g}
                                  className={`${mgColors[g] || "bg-gray-500"} shrink-0`}
                                  style={{ height: `${volPct}%`, minHeight: "2px" }}
                                  title={`${label}: ${g} ${Math.round(vol).toLocaleString()} kg`}
                                />
                              );
                            })}
                          </div>
                          <span className="text-[9px] text-muted-foreground mt-1">{label}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-3 mt-3 text-[10px] text-muted-foreground justify-center flex-wrap">
                    {groups.map(g => (
                      <span key={g} className="flex items-center gap-1">
                        <span className={`w-2 h-2 rounded-sm ${mgColors[g]}`} /> {g}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })()}
          </CardContent>
        </Card>
      )}

      {/* Bottom Row: Program Split + Top Exercises + Recent Workouts */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Program Split */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Program Split
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {programSplit.map((p: any) => (
              <div key={p.program} className="flex items-center justify-between text-sm">
                <span className="font-medium truncate mr-2">{p.program}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-muted-foreground">{Number(p.sessions)}x</span>
                  <span className="text-xs text-muted-foreground">
                    ~{Number(p.avg_duration)}m
                  </span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Top Exercises */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-purple-400" />
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Top Exercises
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <ClickableTopExercises exercises={topExercises.map((e: any) => ({
              exercise: String(e.exercise),
              workout_count: Number(e.workout_count),
              best_weight: Number(e.best_weight),
              avg_weight: Number(e.avg_weight),
            }))} />
          </CardContent>
        </Card>

        {/* Recent Workouts */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
              <span>Recent Workouts</span>
              <span className="text-xs font-normal">{totalWorkoutCount} total</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ClickableWorkoutList
              workouts={(recent as any[]).map((w: any) => ({
                id: w.id,
                title: w.title,
                start_time: w.start_time,
                end_time: w.end_time,
                exercise_count: Number(w.exercise_count),
                exercises: typeof w.exercises === "string" ? JSON.parse(w.exercises) : w.exercises,
                avg_hr: w.avg_hr ? Number(w.avg_hr) : undefined,
                max_hr: w.max_hr ? Number(w.max_hr) : undefined,
                garmin_calories: w.garmin_calories ? Number(w.garmin_calories) : undefined,
              }))}
              totalCount={totalWorkoutCount}
            />
          </CardContent>
        </Card>
      </div>

      {/* Training Calendar */}
      <Card className="mt-6 mb-6">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Training Calendar
          </CardTitle>
        </CardHeader>
        <CardContent>
          <WorkoutCalendar data={calendar as any} />
        </CardContent>
      </Card>

      {/* Exercise PRs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-yellow-400" />
            Personal Records
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ClickablePersonalRecords records={exercisePRs.map((pr: any) => ({
            exercise: String(pr.exercise),
            pr_weight: Number(pr.pr_weight),
            reps_at_pr: pr.reps_at_pr ? Number(pr.reps_at_pr) : null,
          }))} />
        </CardContent>
      </Card>
    </div>
  );
}
