import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getDb } from "@/lib/db";
import { VolumeChart } from "@/components/volume-chart";
import { ExerciseProgressChart } from "@/components/exercise-progress-chart";
import {
  Dumbbell,
  Clock,
  TrendingUp,
  Flame,
  Calendar,
  Target,
} from "lucide-react";

export const revalidate = 300;

async function getRecentWorkouts() {
  const sql = getDb();
  const rows = await sql`
    SELECT
      raw_json->>'id' as id,
      raw_json->>'title' as title,
      raw_json->>'start_time' as start_time,
      raw_json->>'end_time' as end_time,
      jsonb_array_length(raw_json->'exercises') as exercise_count,
      raw_json->'exercises' as exercises
    FROM hevy_raw_data
    WHERE endpoint_name = 'workout'
    ORDER BY raw_json->>'start_time' DESC
    LIMIT 10
  `;
  return rows;
}

async function getWeeklyVolume() {
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

async function getExerciseProgression() {
  const sql = getDb();
  // Get max weight per workout for top compound lifts
  const rows = await sql`
    SELECT
      e->>'title' as exercise,
      (raw_json->>'start_time')::date as workout_date,
      MAX((s->>'weight_kg')::float) as max_weight
    FROM hevy_raw_data,
      jsonb_array_elements(raw_json->'exercises') as e,
      jsonb_array_elements(e->'sets') as s
    WHERE endpoint_name = 'workout'
      AND s->>'type' = 'normal'
      AND (s->>'weight_kg')::float > 0
      AND e->>'title' IN (
        'Bench Press (Barbell)',
        'Overhead Press (Barbell)',
        'Leg Press (Machine)',
        'Iso-Lateral Row (Machine)'
      )
    GROUP BY e->>'title', workout_date
    ORDER BY workout_date ASC
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

async function getTopExercises() {
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
      AND s->>'type' = 'normal'
      AND (s->>'weight_kg')::float > 0
    GROUP BY e->>'title'
    ORDER BY workout_count DESC
    LIMIT 10
  `;
  return rows;
}

async function getProgramSplit() {
  const sql = getDb();
  const rows = await sql`
    SELECT
      raw_json->>'title' as program,
      COUNT(*) as sessions,
      ROUND(AVG(EXTRACT(EPOCH FROM ((raw_json->>'end_time')::timestamp - (raw_json->>'start_time')::timestamp)) / 60)::numeric) as avg_duration
    FROM hevy_raw_data
    WHERE endpoint_name = 'workout'
    GROUP BY raw_json->>'title'
    ORDER BY sessions DESC
    LIMIT 6
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
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function getWorkingSets(exercises: any[]): { totalSets: number; totalVolume: number } {
  let totalSets = 0;
  let totalVolume = 0;
  for (const ex of exercises) {
    for (const s of ex.sets) {
      if (s.type === "normal" && s.weight_kg > 0 && s.reps > 0) {
        totalSets++;
        totalVolume += s.weight_kg * s.reps;
      }
    }
  }
  return { totalSets, totalVolume };
}

export default async function WorkoutsPage() {
  const [recent, weeklyVolume, progression, stats, topExercises, programSplit] =
    await Promise.all([
      getRecentWorkouts(),
      getWeeklyVolume(),
      getExerciseProgression(),
      getWorkoutSummaryStats(),
      getTopExercises(),
      getProgramSplit(),
    ]);

  const totalWeeks = stats
    ? Math.ceil(
        (new Date(stats.last_workout).getTime() - new Date(stats.first_workout).getTime()) /
          (7 * 24 * 60 * 60 * 1000)
      )
    : 0;
  const avgPerWeek = totalWeeks > 0 ? (Number(stats.total_workouts) / totalWeeks).toFixed(1) : "—";

  return (
    <div className="container mx-auto px-6 py-8 max-w-7xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Workouts</h1>
        <p className="text-muted-foreground mt-1">
          Training history and progression
        </p>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Workouts
            </CardTitle>
            <Dumbbell className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{Number(stats?.total_workouts ?? 0)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {avgPerWeek}/week avg
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Avg Duration
            </CardTitle>
            <Clock className="h-4 w-4 text-blue-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats?.avg_duration_min ? `${Math.round(Number(stats.avg_duration_min))}m` : "—"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              ~{stats?.avg_exercises ? Math.round(Number(stats.avg_exercises)) : "—"} exercises/session
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Training Span
            </CardTitle>
            <Calendar className="h-4 w-4 text-green-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalWeeks} weeks</div>
            <p className="text-xs text-muted-foreground mt-1">
              {stats?.first_workout ? formatDate(stats.first_workout) : "—"} → now
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Bench PR
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-orange-400" />
          </CardHeader>
          <CardContent>
            {(() => {
              const bench = topExercises.find(
                (e: any) => e.exercise === "Bench Press (Barbell)"
              );
              return (
                <>
                  <div className="text-2xl font-bold">
                    {bench ? `${Number(bench.best_weight).toFixed(1)} kg` : "—"}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {bench ? `avg ${Number(bench.avg_weight)} kg` : ""}
                  </p>
                </>
              );
            })()}
          </CardContent>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* Weekly Volume */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Flame className="h-4 w-4 text-orange-400" />
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Weekly Volume (kg)
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <VolumeChart data={weeklyVolume as any} />
          </CardContent>
        </Card>

        {/* Exercise Progression */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-400" />
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Strength Progression (max weight per session)
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <ExerciseProgressChart data={progression as any} />
          </CardContent>
        </Card>
      </div>

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
          <CardContent className="space-y-2">
            {topExercises.map((e: any, i: number) => (
              <div key={e.exercise} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 truncate mr-2">
                  <span className="text-xs text-muted-foreground w-4">{i + 1}.</span>
                  <span className="truncate">{e.exercise}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="outline" className="text-xs">
                    {Number(e.best_weight).toFixed(0)}kg
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {Number(e.workout_count)}x
                  </span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Recent Workouts */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Recent Workouts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {recent.map((w: any) => {
              const exercises = typeof w.exercises === "string" ? JSON.parse(w.exercises) : w.exercises;
              const { totalSets, totalVolume } = getWorkingSets(exercises);
              return (
                <div key={w.id} className="border-b border-border/50 last:border-0 pb-3 last:pb-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-sm">{w.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(w.start_time)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{formatDuration(w.start_time, w.end_time)}</span>
                    <span>{Number(w.exercise_count)} exercises</span>
                    <span>{totalSets} sets</span>
                    <span>{Math.round(totalVolume).toLocaleString()} kg</span>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
