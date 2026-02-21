import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/stat-card";
import { WorkoutFrequencyChart } from "@/components/workout-frequency-chart";
import { ClickableRecentActivity } from "@/components/clickable-recent-activity";
import { StepsTrendChart } from "@/components/steps-trend-chart";
import { CalorieTrendChart } from "@/components/calorie-trend-chart";
import { WeightTrendChart } from "@/components/weight-trend-chart";
import { ActivityHeatmap } from "@/components/activity-heatmap";
import { getDb } from "@/lib/db";
import {
  Footprints,
  Flame,
  HeartPulse,
  Moon,
  Brain,
  BatteryCharging,
  Activity,
  Dumbbell,
  Wind,
  Snowflake,
  Mountain,
  Zap,
  Calendar,
  Bike,
  Waves,
  PersonStanding,
  Timer,
  Weight,
  Target,
  Heart,
} from "lucide-react";

export const revalidate = 300;

async function getTodayHealth() {
  const sql = getDb();
  const rows = await sql`
    SELECT * FROM daily_health_summary
    ORDER BY date DESC
    LIMIT 1
  `;
  return rows[0] || null;
}

async function getWeeklyAverages() {
  const sql = getDb();
  const rows = await sql`
    SELECT
      ROUND(AVG(total_steps)) as avg_steps,
      ROUND(AVG(sleep_time_seconds)) as avg_sleep,
      ROUND(AVG(resting_heart_rate)) as avg_rhr,
      ROUND(AVG(avg_stress_level)) as avg_stress,
      ROUND(AVG(active_kilocalories)) as avg_active_cal,
      COUNT(*) as days_count
    FROM daily_health_summary
    WHERE date >= CURRENT_DATE - 7
  `;
  return rows[0] || null;
}

async function getWorkoutStats() {
  const sql = getDb();
  const rows = await sql`
    SELECT
      COUNT(*) as total_workouts,
      MAX(raw_json->>'start_time') as last_workout
    FROM hevy_raw_data
    WHERE endpoint_name = 'workout'
  `;
  const recent = await sql`
    SELECT COUNT(*) as count_7d
    FROM hevy_raw_data
    WHERE endpoint_name = 'workout'
      AND (raw_json->>'start_time')::timestamp >= NOW() - INTERVAL '7 days'
  `;
  return {
    total: rows[0]?.total_workouts ?? 0,
    last: rows[0]?.last_workout ?? null,
    count_7d: recent[0]?.count_7d ?? 0,
  };
}

async function getGymFrequency() {
  const sql = getDb();
  const rows = await sql`
    SELECT
      TO_CHAR((raw_json->>'start_time')::timestamp, 'YYYY-MM') as month,
      COUNT(*) as workouts
    FROM hevy_raw_data
    WHERE endpoint_name = 'workout'
    GROUP BY month
    ORDER BY month ASC
  `;
  return rows;
}

async function getRunningStats() {
  const sql = getDb();
  const rows = await sql`
    SELECT
      COUNT(*) as total_runs,
      SUM((raw_json->>'distance')::float) / 1000.0 as total_km,
      MAX((raw_json->>'vO2MaxValue')::float) as vo2max
    FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
      AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
  `;
  return rows[0] || null;
}

async function getActivityCounts() {
  const sql = getDb();
  const rows = await sql`
    SELECT
      raw_json->'activityType'->>'typeKey' as type_key,
      COUNT(*) as cnt
    FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
    GROUP BY type_key
    ORDER BY cnt DESC
  `;
  return rows;
}

async function getRecentActivities() {
  const sql = getDb();
  // Get recent Garmin activities
  const garminRows = await sql`
    SELECT
      activity_id::text as activity_id,
      raw_json->'activityType'->>'typeKey' as type_key,
      (raw_json->>'startTimeLocal')::text as date,
      raw_json->>'activityName' as name,
      (raw_json->>'distance')::float / 1000.0 as distance_km,
      (raw_json->>'duration')::float / 60.0 as duration_min,
      (raw_json->>'calories')::float as calories
    FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
    ORDER BY (raw_json->>'startTimeLocal')::text DESC
    LIMIT 15
  `;

  // Match gym activities with Hevy workout IDs
  const gymActivityDates = garminRows
    .filter((r: any) => r.type_key === "strength_training")
    .map((r: any) => r.date?.slice(0, 10));

  let hevyMap: Record<string, string> = {};
  if (gymActivityDates.length > 0) {
    const hevyRows = await sql`
      SELECT
        raw_json->>'id' as workout_id,
        LEFT((raw_json->>'start_time')::text, 10) as day
      FROM hevy_raw_data
      WHERE endpoint_name = 'workout'
      ORDER BY raw_json->>'start_time' DESC
      LIMIT 20
    `;
    for (const r of hevyRows) {
      hevyMap[r.day] = r.workout_id;
    }
  }

  return garminRows.map((r: any) => ({
    ...r,
    workout_id: r.type_key === "strength_training"
      ? hevyMap[r.date?.slice(0, 10)] || null
      : null,
  }));
}

async function getWeeklyTrainingSummary() {
  const sql = getDb();
  // This week (Mon-Sun) and last week
  const rows = await sql`
    WITH week_data AS (
      SELECT
        CASE
          WHEN (raw_json->>'startTimeLocal')::timestamp >= DATE_TRUNC('week', CURRENT_DATE)
          THEN 'this_week'
          ELSE 'last_week'
        END as period,
        raw_json->'activityType'->>'typeKey' as type_key,
        (raw_json->>'duration')::float / 3600.0 as hours,
        (raw_json->>'distance')::float / 1000.0 as km,
        (raw_json->>'calories')::float as cal
      FROM garmin_activity_raw
      WHERE endpoint_name = 'summary'
        AND (raw_json->>'startTimeLocal')::timestamp >= DATE_TRUNC('week', CURRENT_DATE) - INTERVAL '7 days'
    )
    SELECT
      period,
      COUNT(*) as sessions,
      ROUND(SUM(hours)::numeric, 1) as total_hours,
      ROUND(SUM(km)::numeric, 0) as total_km,
      ROUND(SUM(cal)::numeric, 0) as total_cal
    FROM week_data
    GROUP BY period
  `;
  const result: Record<string, any> = {};
  for (const r of rows) result[r.period] = r;
  return result;
}

async function getTrainingStreak() {
  const sql = getDb();
  // Get distinct training dates, count consecutive days back from today
  const rows = await sql`
    SELECT DISTINCT LEFT((raw_json->>'startTimeLocal')::text, 10) as day
    FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
    ORDER BY day DESC
    LIMIT 90
  `;
  if (!rows.length) return 0;

  let streak = 0;
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const days = new Set(rows.map((r: any) => r.day));

  // Check from today backwards
  const d = new Date(today);
  // If no activity today, start from yesterday
  if (!days.has(todayStr)) {
    d.setDate(d.getDate() - 1);
  }

  while (days.has(d.toISOString().slice(0, 10))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }

  return streak;
}

async function getStepsTrend() {
  const sql = getDb();
  const rows = await sql`
    SELECT
      date::text as date,
      total_steps as steps
    FROM daily_health_summary
    WHERE total_steps > 0
    ORDER BY date ASC
  `;
  return rows;
}

async function getCalorieTrend() {
  const sql = getDb();
  const rows = await sql`
    SELECT
      date::text as date,
      active_kilocalories as active,
      bmr_kilocalories as bmr
    FROM daily_health_summary
    WHERE active_kilocalories > 0
    ORDER BY date ASC
  `;
  return rows;
}

async function getFitnessAge() {
  const sql = getDb();
  const rows = await sql`
    SELECT
      date::text as date,
      (raw_json->>'fitnessAge')::float as fitness_age,
      (raw_json->>'chronologicalAge')::int as chrono_age,
      (raw_json->>'achievableFitnessAge')::float as achievable_age,
      raw_json->'components' as components
    FROM garmin_raw_data
    WHERE endpoint_name = 'fitnessage_data'
      AND raw_json->>'fitnessAge' IS NOT NULL
    ORDER BY date DESC
    LIMIT 1
  `;
  return rows[0] || null;
}

async function getIntensityMinutes() {
  const sql = getDb();
  const rows = await sql`
    SELECT
      date::text as date,
      (raw_json->>'weekGoal')::int as goal,
      (raw_json->>'weeklyTotal')::int as weekly_total,
      (raw_json->>'weeklyModerate')::int as weekly_moderate,
      (raw_json->>'weeklyVigorous')::int as weekly_vigorous
    FROM garmin_raw_data
    WHERE endpoint_name = 'intensity_minutes_data'
      AND raw_json->>'weekGoal' IS NOT NULL
    ORDER BY date DESC
    LIMIT 1
  `;
  return rows[0] || null;
}

async function getWeightTrend() {
  const sql = getDb();
  const rows = await sql`
    SELECT
      date::text as date,
      (raw_json->'totalAverage'->>'weight')::float / 1000.0 as weight_kg,
      (raw_json->'totalAverage'->>'bodyFat')::float as body_fat
    FROM garmin_raw_data
    WHERE endpoint_name = 'body_composition'
      AND raw_json->'totalAverage'->>'weight' IS NOT NULL
    ORDER BY date ASC
  `;
  return rows;
}

async function getTrainingByDayOfWeek() {
  const sql = getDb();
  const rows = await sql`
    SELECT
      EXTRACT(DOW FROM (raw_json->>'startTimeLocal')::timestamp) as dow,
      COUNT(*) as count
    FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
    GROUP BY dow
    ORDER BY dow ASC
  `;
  return rows;
}

async function getActivityHeatmap() {
  const sql = getDb();
  const rows = await sql`
    SELECT
      LEFT((raw_json->>'startTimeLocal')::text, 10) as date,
      COUNT(*) as count,
      array_agg(DISTINCT raw_json->'activityType'->>'typeKey') as types
    FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
      AND (raw_json->>'startTimeLocal')::timestamp >= CURRENT_DATE - 182
    GROUP BY date
    ORDER BY date ASC
  `;
  return rows;
}

async function getLastWorkoutDetail() {
  const sql = getDb();
  const rows = await sql`
    SELECT
      raw_json->>'title' as title,
      raw_json->>'start_time' as start_time,
      raw_json->>'end_time' as end_time,
      raw_json->'exercises' as exercises
    FROM hevy_raw_data
    WHERE endpoint_name = 'workout'
    ORDER BY raw_json->>'start_time' DESC
    LIMIT 1
  `;
  if (!rows[0]) return null;
  const w = rows[0];
  const exercises = typeof w.exercises === "string" ? JSON.parse(w.exercises) : w.exercises;
  const exerciseNames = exercises.map((e: any) => e.title);
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
  const durationMin = Math.round(
    (new Date(w.end_time).getTime() - new Date(w.start_time).getTime()) / 60000
  );
  return {
    title: w.title,
    date: w.start_time,
    exercises: exerciseNames,
    totalSets,
    totalVolume: Math.round(totalVolume),
    durationMin,
  };
}

const ACTIVITY_ICONS: Record<string, React.ReactNode> = {
  running: <Footprints className="h-3.5 w-3.5 text-green-400" />,
  strength_training: <Dumbbell className="h-3.5 w-3.5 text-orange-400" />,
  kiteboarding_v2: <Wind className="h-3.5 w-3.5 text-cyan-400" />,
  wind_kite_surfing: <Wind className="h-3.5 w-3.5 text-cyan-400" />,
  resort_snowboarding: <Snowflake className="h-3.5 w-3.5 text-blue-300" />,
  resort_skiing_snowboarding_ws: <Snowflake className="h-3.5 w-3.5 text-blue-300" />,
  hiking: <Mountain className="h-3.5 w-3.5 text-green-400" />,
  walking: <PersonStanding className="h-3.5 w-3.5 text-emerald-400" />,
  lap_swimming: <Waves className="h-3.5 w-3.5 text-blue-400" />,
  cycling: <Bike className="h-3.5 w-3.5 text-yellow-400" />,
  e_bike_fitness: <Bike className="h-3.5 w-3.5 text-yellow-400" />,
  indoor_cardio: <Heart className="h-3.5 w-3.5 text-red-400" />,
  indoor_cycling: <Bike className="h-3.5 w-3.5 text-yellow-400" />,
  stand_up_paddleboarding_v2: <Waves className="h-3.5 w-3.5 text-cyan-300" />,
};

const ACTIVITY_BAR_COLORS: Record<string, string> = {
  running: "bg-green-500/70",
  strength_training: "bg-orange-500/70",
  kiteboarding_v2: "bg-cyan-500/70",
  resort_snowboarding: "bg-blue-400/70",
  hiking: "bg-emerald-500/70",
  walking: "bg-emerald-400/70",
  lap_swimming: "bg-blue-500/70",
  cycling: "bg-yellow-500/70",
  e_bike_fitness: "bg-yellow-500/70",
  indoor_cardio: "bg-red-400/70",
  indoor_cycling: "bg-yellow-500/70",
  stand_up_paddleboarding_v2: "bg-cyan-400/70",
  other: "bg-violet-400/70",
};

const ACTIVITY_LABELS: Record<string, string> = {
  running: "Run",
  strength_training: "Gym",
  kiteboarding_v2: "Kite",
  wind_kite_surfing: "Kite",
  resort_snowboarding: "Snow",
  resort_skiing_snowboarding_ws: "Snow",
  hiking: "Hike",
  e_bike_fitness: "E-Bike",
  lap_swimming: "Swim",
  walking: "Walk",
  indoor_cardio: "Cardio",
  indoor_rowing: "Row",
  yoga: "Yoga",
  cycling: "Cycle",
  elliptical: "Elliptical",
  stand_up_paddleboarding_v2: "SUP",
};

// Merge these activity type_keys into a single group for display
const MERGE_TYPES: Record<string, string> = {
  wind_kite_surfing: "kiteboarding_v2",
  resort_skiing_snowboarding_ws: "resort_snowboarding",
  treadmill_running: "running",
  indoor_cycling: "cycling",
};

function formatDuration(mins: number) {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default async function Home() {
  const [health, weekly, workouts, gymFreq, runStats, activityCounts, recentActivities, lastWorkout, weeklyTraining, streak, stepsTrend, fitnessAge, intensityMin, weightTrend, calorieTrend, heatmapData, dayOfWeekData] =
    await Promise.all([
      getTodayHealth(),
      getWeeklyAverages(),
      getWorkoutStats(),
      getGymFrequency(),
      getRunningStats(),
      getActivityCounts(),
      getRecentActivities(),
      getLastWorkoutDetail(),
      getWeeklyTrainingSummary(),
      getTrainingStreak(),
      getStepsTrend(),
      getFitnessAge(),
      getIntensityMinutes(),
      getWeightTrend(),
      getCalorieTrend(),
      getActivityHeatmap(),
      getTrainingByDayOfWeek(),
    ]);

  // Merge duplicate activity types
  const mergedCounts: { type_key: string; cnt: number }[] = [];
  const seen = new Set<string>();
  for (const row of activityCounts) {
    const canonical = MERGE_TYPES[row.type_key] || row.type_key;
    if (seen.has(canonical)) {
      const existing = mergedCounts.find((m) => m.type_key === canonical);
      if (existing) existing.cnt += Number(row.cnt);
    } else {
      seen.add(canonical);
      mergedCounts.push({ type_key: canonical, cnt: Number(row.cnt) });
    }
  }
  mergedCounts.sort((a, b) => b.cnt - a.cnt);
  const totalActivities = mergedCounts.reduce((s, r) => s + r.cnt, 0);

  return (
    <div className="container mx-auto px-6 py-8 max-w-7xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Overview</h1>
        <p className="text-muted-foreground mt-1">
          {health?.date
            ? `Latest: ${new Date(health.date).toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}`
            : "No data synced yet."}
        </p>
      </div>

      {/* Today's Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard
          title="Steps"
          value={health?.total_steps?.toLocaleString() ?? "—"}
          subtitle={health?.total_distance_meters
            ? `${(health.total_distance_meters / 1000).toFixed(1)} km`
            : undefined}
          icon={<Footprints className="h-4 w-4 text-muted-foreground" />}
        />
        <StatCard
          title="Active Calories"
          value={health?.active_kilocalories?.toLocaleString() ?? "—"}
          subtitle={health?.total_kilocalories
            ? `${health.total_kilocalories.toLocaleString()} total`
            : undefined}
          icon={<Flame className="h-4 w-4 text-orange-400" />}
        />
        <StatCard
          title="Resting HR"
          value={health?.resting_heart_rate ? `${health.resting_heart_rate}` : "—"}
          subtitle={health?.min_heart_rate && health?.max_heart_rate
            ? `Range: ${health.min_heart_rate}–${health.max_heart_rate} bpm`
            : undefined}
          icon={<HeartPulse className="h-4 w-4 text-red-400" />}
        />
        <StatCard
          title="VO2max"
          value={runStats?.vo2max ? `${Number(runStats.vo2max)}` : "—"}
          subtitle="ml/kg/min"
          icon={<Zap className="h-4 w-4 text-yellow-400" />}
        />
      </div>

      {/* Secondary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard
          title="Sleep"
          value={health?.sleep_time_seconds
            ? `${(health.sleep_time_seconds / 3600).toFixed(1)}h`
            : "—"}
          icon={<Moon className="h-4 w-4 text-indigo-400" />}
        />
        <StatCard
          title="Avg Stress"
          value={health?.avg_stress_level ?? "—"}
          subtitle={health?.max_stress_level
            ? `Peak: ${health.max_stress_level}`
            : undefined}
          icon={<Brain className="h-4 w-4 text-yellow-400" />}
        />
        <StatCard
          title="Body Battery"
          value={health?.body_battery_charged
            ? `+${health.body_battery_charged}`
            : "—"}
          subtitle={health?.body_battery_drained
            ? `−${health.body_battery_drained} drained`
            : undefined}
          icon={<BatteryCharging className="h-4 w-4 text-green-400" />}
        />
        <StatCard
          title="Total Activities"
          value={totalActivities}
          subtitle={`${Number(runStats?.total_km || 0).toFixed(0)} km running`}
          icon={<Activity className="h-4 w-4 text-purple-400" />}
        />
      </div>

      {/* This Week Training Summary */}
      <Card className="mb-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Activity className="h-4 w-4" />
            This Week
            {streak > 0 && (
              <span className="ml-auto text-xs font-normal text-primary">
                {streak}-day training streak
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {(() => {
            const tw = weeklyTraining.this_week;
            const lw = weeklyTraining.last_week;

            if (!tw) {
              return <p className="text-sm text-muted-foreground">No training this week yet</p>;
            }

            const metrics = [
              { label: "Sessions", value: Number(tw.sessions), prev: lw ? Number(lw.sessions) : null, unit: "" },
              { label: "Duration", value: Number(tw.total_hours), prev: lw ? Number(lw.total_hours) : null, unit: "h" },
              { label: "Distance", value: Number(tw.total_km), prev: lw ? Number(lw.total_km) : null, unit: "km" },
              { label: "Calories", value: Number(tw.total_cal), prev: lw ? Number(lw.total_cal) : null, unit: "kcal" },
            ];

            return (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {metrics.map((m) => {
                  const diff = m.prev !== null ? ((m.value - m.prev) / Math.max(m.prev, 1)) * 100 : null;
                  return (
                    <div key={m.label}>
                      <div className="text-xs text-muted-foreground">{m.label}</div>
                      <div className="text-xl font-bold">
                        {m.unit === "kcal"
                          ? Math.round(m.value).toLocaleString()
                          : m.value}
                        <span className="text-sm font-normal text-muted-foreground ml-1">{m.unit}</span>
                      </div>
                      {diff !== null && (
                        <div className={`text-xs ${diff >= 0 ? "text-green-400" : "text-red-400"}`}>
                          {diff >= 0 ? "+" : ""}{diff.toFixed(0)}% vs last week
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </CardContent>
      </Card>

      {/* Steps & Calorie Trends */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {(stepsTrend as any[]).length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Footprints className="h-4 w-4" />
                Daily Steps
                {weekly?.avg_steps && (
                  <span className="ml-auto text-xs font-normal">
                    7-day avg: {Number(weekly.avg_steps).toLocaleString()}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <StepsTrendChart
                data={(stepsTrend as any[]).slice(-90).map((s: any) => ({
                  date: s.date,
                  steps: Number(s.steps),
                }))}
              />
            </CardContent>
          </Card>
        )}

        {(calorieTrend as any[]).length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Flame className="h-4 w-4 text-orange-400" />
                Daily Calories
                {weekly?.avg_active_cal && (
                  <span className="ml-auto text-xs font-normal">
                    7-day active avg: {Number(weekly.avg_active_cal).toLocaleString()} kcal
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CalorieTrendChart
                data={(calorieTrend as any[]).slice(-90).map((c: any) => ({
                  date: c.date,
                  active: Number(c.active),
                  bmr: Number(c.bmr),
                }))}
              />
            </CardContent>
          </Card>
        )}
      </div>

      {/* Fitness Metrics Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {/* Fitness Age */}
        {fitnessAge && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Heart className="h-4 w-4 text-red-400" />
                Fitness Age
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-end gap-3 mb-2">
                <div className="text-4xl font-bold text-green-400">
                  {Number(fitnessAge.fitness_age).toFixed(1)}
                </div>
                <div className="text-sm text-muted-foreground mb-1">
                  vs {fitnessAge.chrono_age} actual
                </div>
              </div>
              <div className="text-xs text-muted-foreground mb-3">
                {(Number(fitnessAge.chrono_age) - Number(fitnessAge.fitness_age)).toFixed(1)} years younger
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden mb-3">
                <div
                  className="h-full bg-gradient-to-r from-green-500 to-emerald-400 rounded-full"
                  style={{ width: `${Math.min((Number(fitnessAge.fitness_age) / Number(fitnessAge.chrono_age)) * 100, 100)}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground mb-4">
                <span>Best: {Number(fitnessAge.achievable_age).toFixed(1)}</span>
                <span>Actual: {fitnessAge.chrono_age}</span>
              </div>
              {/* Components breakdown */}
              {fitnessAge.components && (() => {
                const comps = typeof fitnessAge.components === "string"
                  ? JSON.parse(fitnessAge.components)
                  : fitnessAge.components;
                const items = [
                  { key: "rhr", label: "Resting HR", value: comps.rhr?.value, unit: "bpm", color: "text-red-400" },
                  { key: "bodyFat", label: "Body Fat", value: comps.bodyFat?.value, unit: "%", target: comps.bodyFat?.targetValue, color: "text-yellow-400" },
                  { key: "vigorousMinutesAvg", label: "Vigorous Min/wk", value: comps.vigorousMinutesAvg?.value, unit: "min", target: comps.vigorousMinutesAvg?.targetValue, color: "text-orange-400" },
                  { key: "vigorousDaysAvg", label: "Vigorous Days/wk", value: comps.vigorousDaysAvg?.value, unit: "days", target: comps.vigorousDaysAvg?.targetValue, color: "text-blue-400" },
                ].filter(c => c.value != null);
                return (
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Components</div>
                    {items.map((c) => (
                      <div key={c.key} className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">{c.label}</span>
                        <div className="flex items-center gap-2">
                          <span className={`font-medium ${c.color}`}>
                            {typeof c.value === "number" ? (Number.isInteger(c.value) ? c.value : Number(c.value).toFixed(1)) : c.value} {c.unit}
                          </span>
                          {c.target && (
                            <span className="text-muted-foreground/50">
                              → {c.target} {c.unit}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        )}

        {/* Intensity Minutes */}
        {intensityMin && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Timer className="h-4 w-4 text-emerald-400" />
                Weekly Intensity Minutes
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-end gap-3 mb-2">
                <div className="text-4xl font-bold">
                  {intensityMin.weekly_total}
                </div>
                <div className="text-sm text-muted-foreground mb-1">
                  / {intensityMin.goal} min goal
                </div>
              </div>
              <div className="h-3 bg-muted rounded-full overflow-hidden mb-2">
                <div
                  className={`h-full rounded-full ${
                    Number(intensityMin.weekly_total) >= Number(intensityMin.goal)
                      ? "bg-green-500"
                      : "bg-emerald-400"
                  }`}
                  style={{ width: `${Math.min((Number(intensityMin.weekly_total) / Number(intensityMin.goal)) * 100, 100)}%` }}
                />
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-blue-400" />
                  Moderate: {intensityMin.weekly_moderate} min
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-orange-400" />
                  Vigorous: {intensityMin.weekly_vigorous} min
                </span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {Math.round((Number(intensityMin.weekly_total) / Number(intensityMin.goal)) * 100)}% of goal
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Body Composition Trend */}
      {(weightTrend as any[]).length > 0 && (
        <Card className="mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Weight className="h-4 w-4 text-blue-400" />
              Body Composition
              {(() => {
                const data = (weightTrend as any[]).filter((w: any) => w.weight_kg > 0);
                if (data.length === 0) return null;
                const latest = data[data.length - 1];
                return (
                  <span className="ml-auto text-xs font-normal">
                    {Number(latest.weight_kg).toFixed(1)} kg
                    {latest.body_fat ? ` · ${Number(latest.body_fat).toFixed(1)}% BF` : ""}
                  </span>
                );
              })()}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <WeightTrendChart
              data={(weightTrend as any[]).filter((w: any) => w.weight_kg > 0).map((w: any) => ({
                date: w.date,
                weight_kg: Number(w.weight_kg),
                body_fat: w.body_fat ? Number(w.body_fat) : null,
              }))}
            />
          </CardContent>
        </Card>
      )}

      {/* Activity Heatmap */}
      {(heatmapData as any[]).length > 0 && (
        <Card className="mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Activity Calendar
              {streak > 0 && (
                <span className="ml-auto text-xs font-normal text-primary">
                  {streak}-day streak
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ActivityHeatmap
              data={(heatmapData as any[]).map((d: any) => ({
                date: d.date,
                count: Number(d.count),
                types: Array.isArray(d.types) ? d.types : [],
              }))}
            />
          </CardContent>
        </Card>
      )}

      {/* Training Day Distribution */}
      {(dayOfWeekData as any[]).length > 0 && (
        <Card className="mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Training Days
              <span className="ml-auto text-xs font-normal">
                Most active: {(() => {
                  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
                  const sorted = [...(dayOfWeekData as any[])].sort((a, b) => Number(b.count) - Number(a.count));
                  return sorted.length > 0 ? days[Number(sorted[0].dow)] : "";
                })()}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-3 h-32">
              {(() => {
                const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
                const counts = new Array(7).fill(0);
                for (const row of dayOfWeekData as any[]) {
                  counts[Number(row.dow)] = Number(row.count);
                }
                const max = Math.max(...counts);
                const total = counts.reduce((s: number, c: number) => s + c, 0);
                return counts.map((count, i) => {
                  const pct = max > 0 ? (count / max) * 100 : 0;
                  const isMax = count === max;
                  const sharePct = total > 0 ? ((count / total) * 100).toFixed(0) : "0";
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1">
                      <span className="text-xs font-semibold">{count}</span>
                      <div className="w-full flex items-end justify-center" style={{ height: "80px" }}>
                        <div
                          className={`w-full max-w-[40px] rounded-t transition-all ${
                            isMax ? "bg-primary" : "bg-primary/40"
                          }`}
                          style={{ height: `${Math.max(pct, 4)}%` }}
                          title={`${days[i]}: ${count} activities (${sharePct}%)`}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground font-medium">{days[i]}</span>
                    </div>
                  );
                });
              })()}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Middle Row: Activity Breakdown + Gym Frequency + Last Workout */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {/* Activity Breakdown */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Activity Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {mergedCounts.map((a) => {
              const icon = ACTIVITY_ICONS[a.type_key] || <Activity className="h-3.5 w-3.5" />;
              const label = ACTIVITY_LABELS[a.type_key] || a.type_key.replace(/_/g, " ");
              const pct = totalActivities > 0 ? (a.cnt / mergedCounts[0].cnt) * 100 : 0;
              const barColor = ACTIVITY_BAR_COLORS[a.type_key] || "bg-primary/60";
              return (
                <div key={a.type_key} className="flex items-center gap-2 text-sm">
                  {icon}
                  <span className="text-muted-foreground w-14 truncate">{label}</span>
                  <div className="flex-1 h-4 bg-muted rounded-sm overflow-hidden">
                    <div
                      className={`h-full ${barColor} rounded-sm`}
                      style={{ width: `${Math.max(pct, 3)}%` }}
                    />
                  </div>
                  <span className="font-medium w-8 text-right">{a.cnt}</span>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Gym Frequency */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Gym Frequency
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 mb-3">
              <Dumbbell className="h-5 w-5 text-primary" />
              <span className="text-2xl font-bold">{Number(workouts.total)}</span>
              <span className="text-sm text-muted-foreground">workouts</span>
              <span className="text-xs text-muted-foreground ml-auto">
                {Number(workouts.count_7d)} this week
              </span>
            </div>
            <WorkoutFrequencyChart data={gymFreq as any} />
          </CardContent>
        </Card>

        {/* Last Workout */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Last Gym Session
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {lastWorkout ? (
              <>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold">{lastWorkout.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(lastWorkout.date).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground mb-2">
                  <span>{lastWorkout.durationMin}m</span>
                  <span>{lastWorkout.exercises.length} exercises</span>
                  <span>{lastWorkout.totalSets} sets</span>
                  <span>{lastWorkout.totalVolume.toLocaleString()} kg</span>
                </div>
                <div className="space-y-1">
                  {lastWorkout.exercises.slice(0, 5).map((name: string, i: number) => (
                    <div key={i} className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <span className="w-1 h-1 rounded-full bg-primary shrink-0" />
                      {name}
                    </div>
                  ))}
                  {lastWorkout.exercises.length > 5 && (
                    <div className="text-xs text-muted-foreground/50">
                      +{lastWorkout.exercises.length - 5} more
                    </div>
                  )}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No workouts yet</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity Feed */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Recent Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ClickableRecentActivity
            activities={(recentActivities as any[]).map((a: any) => ({
              type_key: a.type_key,
              date: a.date,
              name: a.name,
              distance_km: Number(a.distance_km),
              duration_min: Number(a.duration_min),
              calories: a.calories ? Number(a.calories) : null,
              activity_id: a.activity_id,
              workout_id: a.workout_id || undefined,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
