import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExpandableChartCard } from "@/components/expandable-chart-card";
import { Badge } from "@/components/ui/badge";
import { getDb } from "@/lib/db";
import { VolumeChart } from "@/components/volume-chart";
import { ExerciseProgressChart } from "@/components/exercise-progress-chart";
import { ClickableWorkoutList } from "@/components/clickable-workout-list";
import { TimeRangeSelector } from "@/components/time-range-selector";
import { rangeToDays } from "@/lib/time-ranges";
import {
  Dumbbell,
  Clock,
  TrendingUp,
  Flame,
  Calendar,
  Target,
  HeartPulse,
} from "lucide-react";

export const revalidate = 300;

async function getRecentWorkouts(cutoff: string) {
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
    LIMIT 20
  `;
  return rows;
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

async function getExerciseProgression(cutoff: string) {
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
      AND (raw_json->>'start_time')::timestamp >= ${cutoff}::date
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
      HAVING MAX(weight) >= 20
    )
    SELECT m.exercise, m.pr_weight, MAX(a.reps) as reps_at_pr
    FROM maxes m
    JOIN all_sets a ON a.exercise = m.exercise AND a.weight = m.pr_weight
    GROUP BY m.exercise, m.pr_weight
    ORDER BY m.pr_weight DESC
    LIMIT 12
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
      ROUND(SUM((s->>'weight_kg')::float * (s->>'reps')::int)::numeric) as total_volume
    FROM exercise_muscles
    WHERE muscle_group != 'other'
    GROUP BY muscle_group
    ORDER BY total_volume DESC
  `;
  return rows;
}

async function getWorkoutFrequencyByWeek(cutoff: string) {
  const sql = getDb();
  const rows = await sql`
    SELECT
      DATE_TRUNC('week', (raw_json->>'start_time')::timestamp)::date as week,
      COUNT(*) as workouts,
      ROUND(AVG(EXTRACT(EPOCH FROM ((raw_json->>'end_time')::timestamp - (raw_json->>'start_time')::timestamp)) / 60)::numeric) as avg_duration
    FROM hevy_raw_data
    WHERE endpoint_name = 'workout'
      AND (raw_json->>'start_time')::timestamp >= ${cutoff}::date
    GROUP BY week
    ORDER BY week ASC
  `;
  return rows;
}

async function getMonthlyMuscleVolume(cutoff: string) {
  const sql = getDb();
  const rows = await sql`
    WITH exercise_muscles AS (
      SELECT
        TO_CHAR((raw_json->>'start_time')::timestamp, 'YYYY-MM') as month,
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
        AND (raw_json->>'start_time')::timestamp >= ${cutoff}::date
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

async function getTrainingCalendar(cutoff: string) {
  const sql = getDb();
  const rows = await sql`
    SELECT
      (raw_json->>'start_time')::date as day,
      raw_json->>'title' as program
    FROM hevy_raw_data
    WHERE endpoint_name = 'workout'
      AND (raw_json->>'start_time')::date >= ${cutoff}::date
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
  const calCutoff = new Date(Date.now() - Math.min(rangeDays, 365) * 86400000).toISOString().split("T")[0];

  const [recent, weeklyVolume, progression, stats, topExercises, programSplit, exercisePRs, calendar, muscleGroups, weeklyFreq, monthlyMuscle, calorieStats] =
    await Promise.all([
      getRecentWorkouts(cutoff),
      getWeeklyVolume(cutoff),
      getExerciseProgression(cutoff),
      getWorkoutSummaryStats(),
      getTopExercises(cutoff),
      getProgramSplit(cutoff),
      getExercisePRs(),
      getTrainingCalendar(calCutoff),
      getMuscleGroupVolume(cutoff),
      getWorkoutFrequencyByWeek(cutoff),
      getMonthlyMuscleVolume(cutoff),
      getGarminCalorieStats(cutoff),
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
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Workouts</h1>
          <p className="text-muted-foreground mt-1">
            Training history and progression
          </p>
        </div>
        <TimeRangeSelector />
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
              Avg Calories
            </CardTitle>
            <HeartPulse className="h-4 w-4 text-red-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {calorieStats?.avg_calories ? `${Number(calorieStats.avg_calories)}` : "—"}
              <span className="text-sm font-normal text-muted-foreground ml-1">kcal</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {calorieStats?.matched && calorieStats?.total
                ? `${Number(calorieStats.matched)} of ${Number(calorieStats.total)} matched`
                : "via Garmin HR"}
            </p>
          </CardContent>
        </Card>
      </div>

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

        <ExpandableChartCard title="Strength Progression (max weight per session)" icon={<TrendingUp className="h-4 w-4 text-green-400" />}>
          <ExerciseProgressChart data={progression as any} />
        </ExpandableChartCard>
      </div>

      {/* Weekly Workout Frequency */}
      {(weeklyFreq as any[]).length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Calendar className="h-4 w-4 text-blue-400" />
              Weekly Workout Frequency
              <span className="ml-auto text-xs font-normal">
                {(() => {
                  const recent12 = (weeklyFreq as any[]).slice(-12);
                  const avg = recent12.reduce((s: number, w: any) => s + Number(w.workouts), 0) / recent12.length;
                  return `12-week avg: ${avg.toFixed(1)}/week`;
                })()}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const weeks = (weeklyFreq as any[]).slice(-52);
              const maxW = Math.max(...weeks.map((x: any) => Number(x.workouts)));
              return (
                <>
                  <div className="flex items-end gap-[2px] h-24">
                    {weeks.map((w: any, i: number) => {
                      const count = Number(w.workouts);
                      const pct = maxW > 0 ? (count / maxW) * 100 : 0;
                      const weekDate = new Date(w.week);
                      const label = weekDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                      const color = count >= 4 ? "bg-green-500" :
                        count >= 3 ? "bg-green-400/80" :
                        count >= 2 ? "bg-primary/60" :
                        count >= 1 ? "bg-primary/30" : "bg-muted/30";
                      return (
                        <div key={i} className="flex-1 flex items-end justify-center" style={{ height: "80px" }}>
                          <div
                            className={`w-full rounded-t-sm ${color}`}
                            style={{ height: `${Math.max(pct, count > 0 ? 6 : 0)}%` }}
                            title={`${label}: ${count} workouts · ${w.avg_duration}m avg`}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex gap-[2px] mt-1">
                    {weeks.map((w: any, i: number) => {
                      const d = new Date(w.week);
                      const prev = i > 0 ? new Date(weeks[i - 1].week) : null;
                      const isNewMonth = !prev || d.getMonth() !== prev.getMonth();
                      return (
                        <div key={i} className="flex-1 text-[9px] text-muted-foreground overflow-hidden">
                          {isNewMonth ? d.toLocaleDateString("en-US", { month: "short" }) : ""}
                        </div>
                      );
                    })}
                  </div>
                </>
              );
            })()}
            <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground justify-center">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-primary/30" /> 1</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-primary/60" /> 2</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-green-400/80" /> 3</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-green-500" /> 4+</span>
              <span className="text-muted-foreground/50 ml-1">workouts/week</span>
            </div>
          </CardContent>
        </Card>
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
            {(() => {
              const mgColors: Record<string, string> = {
                legs: "bg-blue-500",
                back: "bg-green-500",
                chest: "bg-red-500",
                shoulders: "bg-orange-500",
                biceps: "bg-cyan-500",
                triceps: "bg-purple-500",
                core: "bg-yellow-500",
                calves: "bg-emerald-500",
                forearms: "bg-pink-500",
              };
              const totalVol = muscleGroups.reduce((s: number, mg: any) => s + Number(mg.total_volume), 0);
              return (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {muscleGroups.map((mg: any) => {
                    const maxVol = Number(muscleGroups[0]?.total_volume || 1);
                    const vol = Number(mg.total_volume);
                    const pct = (vol / maxVol) * 100;
                    const volPct = totalVol > 0 ? ((vol / totalVol) * 100).toFixed(0) : "0";
                    const barColor = mgColors[mg.muscle_group] || "bg-purple-400";
                    return (
                      <div key={mg.muscle_group} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium capitalize">{mg.muscle_group}</span>
                          <span className="text-muted-foreground">{Number(mg.total_sets)} sets</span>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full ${barColor} rounded-full`}
                            style={{ width: `${Math.max(pct, 5)}%` }}
                          />
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {vol.toLocaleString()} kg · {volPct}%
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
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
            />
          </CardContent>
        </Card>
      </div>

      {/* Training Calendar Heatmap — GitHub-style grid */}
      <Card className="mt-6 mb-6">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Training Calendar (Last 13 Weeks)
            <span className="ml-auto text-xs font-normal">
              {calendar.length} sessions in 90 days
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {(() => {
            const today = new Date();
            const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

            const currentDay = today.getDay();
            const daysToMon = currentDay === 0 ? 6 : currentDay - 1;
            const thisMon = new Date(today);
            thisMon.setDate(thisMon.getDate() - daysToMon);
            const startMon = new Date(thisMon);
            startMon.setDate(startMon.getDate() - 12 * 7);

            const calSet = new Map<string, string>();
            for (const c of calendar as any[]) {
              // Normalize date to YYYY-MM-DD regardless of input format
              const d = c.day instanceof Date
                ? c.day.toISOString().split("T")[0]
                : String(c.day).slice(0, 10);
              calSet.set(d, c.program);
            }

            // Color map for programs
            const programColors: Record<string, string> = {};
            const palette = [
              "bg-blue-500", "bg-green-500", "bg-orange-500", "bg-purple-500",
              "bg-cyan-500", "bg-rose-500", "bg-yellow-500", "bg-emerald-500",
            ];
            let colorIdx = 0;
            for (const c of calendar as any[]) {
              if (c.program && !programColors[c.program]) {
                programColors[c.program] = palette[colorIdx % palette.length];
                colorIdx++;
              }
            }

            const weeks: { date: string; trained: boolean; program: string | null }[][] = [];
            const d = new Date(startMon);
            while (d <= today) {
              const weekIdx = Math.floor(
                (d.getTime() - startMon.getTime()) / (7 * 24 * 60 * 60 * 1000)
              );
              if (!weeks[weekIdx]) weeks[weekIdx] = [];
              const dateStr = d.toISOString().split("T")[0];
              const dayOfWeek = d.getDay() === 0 ? 6 : d.getDay() - 1;
              weeks[weekIdx][dayOfWeek] = {
                date: dateStr,
                trained: calSet.has(dateStr),
                program: calSet.get(dateStr) || null,
              };
              d.setDate(d.getDate() + 1);
            }

            const monthLabels: { label: string; colStart: number }[] = [];
            let lastMonth = "";
            for (let w = 0; w < weeks.length; w++) {
              const firstDay = weeks[w]?.find(Boolean);
              if (firstDay) {
                const m = new Date(firstDay.date).toLocaleDateString("en-US", { month: "short" });
                if (m !== lastMonth) {
                  monthLabels.push({ label: m, colStart: w });
                  lastMonth = m;
                }
              }
            }

            return (
              <div className="overflow-x-auto">
                {/* Month labels */}
                <div className="flex ml-10 mb-1">
                  {monthLabels.map((ml, i) => {
                    const nextCol = i < monthLabels.length - 1 ? monthLabels[i + 1].colStart : weeks.length;
                    const span = nextCol - ml.colStart;
                    return (
                      <div
                        key={`${ml.label}-${ml.colStart}`}
                        className="text-xs text-muted-foreground"
                        style={{ width: `${span * 22}px` }}
                      >
                        {ml.label}
                      </div>
                    );
                  })}
                </div>
                <div className="flex gap-0">
                  <div className="flex flex-col gap-[2px] mr-1.5">
                    {dayLabels.map((label, i) => (
                      <div key={label} className="h-[20px] flex items-center">
                        {i % 2 === 0 ? (
                          <span className="text-[10px] text-muted-foreground w-7 text-right">{label}</span>
                        ) : (
                          <span className="w-7" />
                        )}
                      </div>
                    ))}
                  </div>
                  {weeks.map((week, wi) => (
                    <div key={wi} className="flex flex-col gap-[2px]">
                      {Array.from({ length: 7 }, (_, di) => {
                        const cell = week?.[di];
                        if (!cell) return <div key={di} className="w-[20px] h-[20px]" />;
                        const isTrained = cell.trained;
                        const color = isTrained && cell.program
                          ? programColors[cell.program] || "bg-primary"
                          : isTrained
                            ? "bg-primary"
                            : "";
                        return (
                          <div
                            key={di}
                            className={`w-[20px] h-[20px] rounded-sm ${isTrained ? color : "border border-muted-foreground/15 bg-muted-foreground/5"} ${
                              isTrained ? "hover:opacity-80" : "hover:bg-muted-foreground/10"
                            } transition-opacity`}
                            title={`${cell.date}${cell.program ? ` — ${cell.program}` : ""}`}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
          {/* Program color legend */}
          {(() => {
            const programColors: Record<string, string> = {};
            const palette = [
              "bg-blue-500", "bg-green-500", "bg-orange-500", "bg-purple-500",
              "bg-cyan-500", "bg-rose-500", "bg-yellow-500", "bg-emerald-500",
            ];
            let colorIdx = 0;
            for (const c of calendar as any[]) {
              if (c.program && !programColors[c.program]) {
                programColors[c.program] = palette[colorIdx % palette.length];
                colorIdx++;
              }
            }
            const entries = Object.entries(programColors);
            if (entries.length === 0) return null;
            return (
              <div className="flex flex-wrap items-center gap-3 mt-3 text-xs text-muted-foreground">
                {entries.map(([program, color]) => (
                  <span key={program} className="flex items-center gap-1">
                    <span className={`w-3 h-3 rounded-sm ${color}`} />
                    {program}
                  </span>
                ))}
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded-sm bg-muted/40" />
                  Rest
                </span>
              </div>
            );
          })()}
        </CardContent>
      </Card>

      {/* Exercise PRs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-yellow-400" />
            Personal Records (all exercises)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {exercisePRs.map((pr: any) => (
              <div key={pr.exercise} className="border border-border/50 rounded-lg p-3">
                <div className="text-xs text-muted-foreground truncate mb-1">{pr.exercise}</div>
                <div className="text-lg font-bold">{Number(pr.pr_weight).toFixed(1)} kg</div>
                {pr.reps_at_pr && (
                  <div className="text-xs text-muted-foreground">
                    {pr.reps_at_pr} reps
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
