import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getDb } from "@/lib/db";
import { VolumeChart } from "@/components/volume-chart";
import { ExerciseProgressChart } from "@/components/exercise-progress-chart";
import { ClickableWorkoutList } from "@/components/clickable-workout-list";
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

async function getExercisePRs() {
  const sql = getDb();
  const rows = await sql`
    SELECT
      e->>'title' as exercise,
      MAX((s->>'weight_kg')::float) as pr_weight,
      MAX((s->>'reps')::int) FILTER (WHERE (s->>'weight_kg')::float = (
        SELECT MAX((s2->>'weight_kg')::float)
        FROM hevy_raw_data h2,
          jsonb_array_elements(h2.raw_json->'exercises') e2,
          jsonb_array_elements(e2->'sets') s2
        WHERE h2.endpoint_name = 'workout' AND e2->>'title' = e->>'title' AND s2->>'type' = 'normal'
      )) as reps_at_pr
    FROM hevy_raw_data,
      jsonb_array_elements(raw_json->'exercises') as e,
      jsonb_array_elements(e->'sets') as s
    WHERE endpoint_name = 'workout'
      AND s->>'type' = 'normal'
      AND (s->>'weight_kg')::float > 0
    GROUP BY e->>'title'
    HAVING MAX((s->>'weight_kg')::float) >= 20
    ORDER BY MAX((s->>'weight_kg')::float) DESC
    LIMIT 12
  `;
  return rows;
}

async function getMuscleGroupVolume() {
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

async function getTrainingCalendar() {
  const sql = getDb();
  const rows = await sql`
    SELECT
      (raw_json->>'start_time')::date as day,
      raw_json->>'title' as program
    FROM hevy_raw_data
    WHERE endpoint_name = 'workout'
      AND (raw_json->>'start_time')::date >= CURRENT_DATE - 90
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
  const [recent, weeklyVolume, progression, stats, topExercises, programSplit, exercisePRs, calendar, muscleGroups] =
    await Promise.all([
      getRecentWorkouts(),
      getWeeklyVolume(),
      getExerciseProgression(),
      getWorkoutSummaryStats(),
      getTopExercises(),
      getProgramSplit(),
      getExercisePRs(),
      getTrainingCalendar(),
      getMuscleGroupVolume(),
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
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {muscleGroups.map((mg: any) => {
                const maxVol = Number(muscleGroups[0]?.total_volume || 1);
                const vol = Number(mg.total_volume);
                const pct = (vol / maxVol) * 100;
                return (
                  <div key={mg.muscle_group} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium capitalize">{mg.muscle_group}</span>
                      <span className="text-muted-foreground">{Number(mg.total_sets)} sets</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-purple-400 rounded-full"
                        style={{ width: `${Math.max(pct, 5)}%` }}
                      />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {vol.toLocaleString()} kg total
                    </div>
                  </div>
                );
              })}
            </div>
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
              }))}
            />
          </CardContent>
        </Card>
      </div>

      {/* Training Calendar Heatmap — GitHub-style grid */}
      <Card className="mt-6 mb-6">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Training Calendar (Last 13 Weeks)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {(() => {
            const today = new Date();
            // Build 13 weeks (91 days) aligned to week boundaries
            const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

            // Find the Monday 13 weeks ago
            const currentDay = today.getDay(); // 0=Sun
            const daysToMon = currentDay === 0 ? 6 : currentDay - 1;
            const thisMon = new Date(today);
            thisMon.setDate(thisMon.getDate() - daysToMon);
            const startMon = new Date(thisMon);
            startMon.setDate(startMon.getDate() - 12 * 7);

            // Build calendarSet for O(1) lookup
            const calSet = new Map<string, string>();
            for (const c of calendar as any[]) {
              calSet.set(String(c.day), c.program);
            }

            // Build weeks array
            const weeks: { date: string; trained: boolean; program: string | null }[][] = [];
            const d = new Date(startMon);
            while (d <= today) {
              const weekIdx = Math.floor(
                (d.getTime() - startMon.getTime()) / (7 * 24 * 60 * 60 * 1000)
              );
              if (!weeks[weekIdx]) weeks[weekIdx] = [];
              const dateStr = d.toISOString().split("T")[0];
              const dayOfWeek = d.getDay() === 0 ? 6 : d.getDay() - 1; // Mon=0
              weeks[weekIdx][dayOfWeek] = {
                date: dateStr,
                trained: calSet.has(dateStr),
                program: calSet.get(dateStr) || null,
              };
              d.setDate(d.getDate() + 1);
            }

            // Month labels
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
                <div className="flex ml-8 mb-1">
                  {monthLabels.map((ml, i) => {
                    const nextCol = i < monthLabels.length - 1 ? monthLabels[i + 1].colStart : weeks.length;
                    const span = nextCol - ml.colStart;
                    return (
                      <div
                        key={`${ml.label}-${ml.colStart}`}
                        className="text-xs text-muted-foreground"
                        style={{ width: `${span * 16}px` }}
                      >
                        {ml.label}
                      </div>
                    );
                  })}
                </div>
                {/* Grid: rows = days of week, columns = weeks */}
                <div className="flex gap-0">
                  {/* Day labels */}
                  <div className="flex flex-col gap-[2px] mr-1">
                    {dayLabels.map((label, i) => (
                      <div key={label} className="h-[14px] flex items-center">
                        {i % 2 === 0 ? (
                          <span className="text-[9px] text-muted-foreground w-6 text-right">{label}</span>
                        ) : (
                          <span className="w-6" />
                        )}
                      </div>
                    ))}
                  </div>
                  {/* Week columns */}
                  {weeks.map((week, wi) => (
                    <div key={wi} className="flex flex-col gap-[2px]">
                      {Array.from({ length: 7 }, (_, di) => {
                        const cell = week?.[di];
                        if (!cell) return <div key={di} className="w-[14px] h-[14px]" />;
                        return (
                          <div
                            key={di}
                            className={`w-[14px] h-[14px] rounded-sm ${
                              cell.trained
                                ? "bg-primary hover:bg-primary/80"
                                : "bg-muted/50 hover:bg-muted"
                            }`}
                            title={`${cell.date}${cell.program ? `: ${cell.program}` : ""}`}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
          <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-sm bg-primary" /> Trained
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-sm bg-muted/50" /> Rest
            </span>
            <span className="ml-auto">
              {calendar.length} sessions in 90 days
            </span>
          </div>
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
