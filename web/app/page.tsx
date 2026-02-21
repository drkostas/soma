import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExpandableChartCard } from "@/components/expandable-chart-card";
import { ClickableStatCards } from "@/components/clickable-stat-cards";
import { InteractiveChartCards } from "@/components/interactive-chart-cards";
import { ClickableRecentActivity } from "@/components/clickable-recent-activity";
import { ClickableRecoveryCard } from "@/components/clickable-recovery-card";
import { ClickableLastWorkout } from "@/components/clickable-last-workout";
import { StepsTrendChart } from "@/components/steps-trend-chart";
import { CalorieTrendChart } from "@/components/calorie-trend-chart";
import { WeightTrendChart } from "@/components/weight-trend-chart";
import { ActivityHeatmap } from "@/components/activity-heatmap";
import { RHRChart } from "@/components/rhr-chart";
import { StressChart } from "@/components/stress-chart";
import { ExpandableExerciseList } from "@/components/expandable-exercise-list";
import { InteractiveThisWeek } from "@/components/interactive-this-week";
import { TimeRangeSelector } from "@/components/time-range-selector";
import { rangeToDays } from "@/lib/time-ranges";
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

async function getGymFrequency(cutoff: string) {
  const sql = getDb();
  const rows = await sql`
    SELECT
      TO_CHAR((raw_json->>'start_time')::timestamp, 'YYYY-MM') as month,
      COUNT(*) as workouts
    FROM hevy_raw_data
    WHERE endpoint_name = 'workout'
      AND (raw_json->>'start_time')::timestamp >= ${cutoff}::date
    GROUP BY month
    ORDER BY month ASC
  `;
  return rows;
}

async function getRunningStats(cutoff: string) {
  const sql = getDb();
  const rows = await sql`
    SELECT
      COUNT(*) as total_runs,
      SUM((raw_json->>'distance')::float) / 1000.0 as total_km,
      MAX((raw_json->>'vO2MaxValue')::float) as vo2max
    FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
      AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
      AND (raw_json->>'startTimeLocal')::timestamp >= ${cutoff}::date
  `;
  return rows[0] || null;
}

async function getActivityCounts(cutoff: string) {
  const sql = getDb();
  const rows = await sql`
    SELECT
      raw_json->'activityType'->>'typeKey' as type_key,
      COUNT(*) as cnt
    FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
      AND (raw_json->>'startTimeLocal')::timestamp >= ${cutoff}::date
    GROUP BY type_key
    ORDER BY cnt DESC
  `;
  return rows;
}

async function getRecentActivities(cutoff: string) {
  const sql = getDb();
  // Get recent Garmin activities (dedup by startTime+name, keep highest-calorie entry)
  const garminRows = await sql`
    SELECT * FROM (
      SELECT DISTINCT ON ((raw_json->>'startTimeLocal'), raw_json->>'activityName')
        activity_id::text as activity_id,
        raw_json->'activityType'->>'typeKey' as type_key,
        (raw_json->>'startTimeLocal')::text as date,
        raw_json->>'activityName' as name,
        (raw_json->>'distance')::float / 1000.0 as distance_km,
        (raw_json->>'duration')::float / 60.0 as duration_min,
        (raw_json->>'calories')::float as calories
      FROM garmin_activity_raw
      WHERE endpoint_name = 'summary'
        AND (raw_json->>'startTimeLocal')::timestamp >= ${cutoff}::date
      ORDER BY (raw_json->>'startTimeLocal'), raw_json->>'activityName', (raw_json->>'calories')::float DESC
    ) deduped
    ORDER BY date DESC
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

async function getStepsTrend(cutoff: string) {
  const sql = getDb();
  const rows = await sql`
    SELECT
      date::text as date,
      total_steps as steps
    FROM daily_health_summary
    WHERE total_steps > 0
      AND date >= ${cutoff}::date
    ORDER BY date ASC
  `;
  return rows;
}

async function getCalorieTrend(cutoff: string) {
  const sql = getDb();
  const rows = await sql`
    SELECT
      date::text as date,
      active_kilocalories as active,
      bmr_kilocalories as bmr
    FROM daily_health_summary
    WHERE active_kilocalories > 0
      AND date >= ${cutoff}::date
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

async function getWeightTrend(cutoff: string) {
  const sql = getDb();
  const rows = await sql`
    SELECT
      date::text as date,
      (raw_json->'totalAverage'->>'weight')::float / 1000.0 as weight_kg,
      (raw_json->'totalAverage'->>'bodyFat')::float as body_fat
    FROM garmin_raw_data
    WHERE endpoint_name = 'body_composition'
      AND raw_json->'totalAverage'->>'weight' IS NOT NULL
      AND date >= ${cutoff}::date
    ORDER BY date ASC
  `;
  return rows;
}

async function getTrainingByDayOfWeek(cutoff: string) {
  const sql = getDb();
  const rows = await sql`
    SELECT
      EXTRACT(DOW FROM (raw_json->>'startTimeLocal')::timestamp) as dow,
      COUNT(*) as count
    FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
      AND (raw_json->>'startTimeLocal')::timestamp >= ${cutoff}::date
    GROUP BY dow
    ORDER BY dow ASC
  `;
  return rows;
}

async function getRecoverySummary() {
  const sql = getDb();
  // Get latest body battery, HRV, and training readiness
  const [bb, hrv, tr] = await Promise.all([
    sql`
      SELECT
        (raw_json->>'bodyBatteryChargedValue')::int as charged,
        (raw_json->>'bodyBatteryDrainedValue')::int as drained
      FROM garmin_raw_data
      WHERE endpoint_name = 'user_summary'
        AND raw_json->>'bodyBatteryChargedValue' IS NOT NULL
        AND (raw_json->>'bodyBatteryChargedValue')::int > 0
      ORDER BY date DESC LIMIT 1
    `,
    sql`
      SELECT
        (raw_json->'hrvSummary'->>'weeklyAvg')::int as weekly_avg,
        (raw_json->'hrvSummary'->>'lastNightAvg')::int as last_night,
        raw_json->'hrvSummary'->>'status' as status
      FROM garmin_raw_data
      WHERE endpoint_name = 'hrv_data'
        AND raw_json->'hrvSummary'->>'weeklyAvg' IS NOT NULL
      ORDER BY date DESC LIMIT 1
    `,
    sql`
      SELECT
        (raw_json->0->>'score')::int as score,
        raw_json->0->>'level' as level
      FROM garmin_raw_data
      WHERE endpoint_name = 'training_readiness'
        AND raw_json->0->>'score' IS NOT NULL
      ORDER BY date DESC LIMIT 1
    `,
  ]);
  return {
    bodyBattery: bb[0] || null,
    hrv: hrv[0] || null,
    readiness: tr[0] || null,
  };
}

async function getLatestSleep() {
  const sql = getDb();
  const rows = await sql`
    SELECT
      (raw_json->'dailySleepDTO'->>'sleepTimeSeconds')::int as total,
      (raw_json->'dailySleepDTO'->'sleepScores'->'overall'->>'value')::int as score,
      (raw_json->'dailySleepDTO'->'sleepScores'->'overall'->>'qualifierKey') as quality
    FROM garmin_raw_data
    WHERE endpoint_name = 'sleep_data'
      AND (raw_json->'dailySleepDTO'->>'sleepTimeSeconds')::int > 0
    ORDER BY date DESC
    LIMIT 1
  `;
  return rows[0] || null;
}

async function getStressTrend(cutoff: string) {
  const sql = getDb();
  const rows = await sql`
    SELECT
      date::text as date,
      avg_stress_level as avg_stress,
      max_stress_level as max_stress
    FROM daily_health_summary
    WHERE avg_stress_level > 0
      AND date >= ${cutoff}::date
    ORDER BY date ASC
  `;
  return rows;
}

async function getRestingHRTrend(cutoff: string) {
  const sql = getDb();
  const rows = await sql`
    SELECT
      date::text as date,
      resting_heart_rate as rhr
    FROM daily_health_summary
    WHERE resting_heart_rate > 0
      AND date >= ${cutoff}::date
    ORDER BY date ASC
  `;
  return rows;
}

async function getFloorsTrend(cutoff: string) {
  const sql = getDb();
  const rows = await sql`
    SELECT
      date::text as date,
      (
        SELECT COALESCE(SUM((elem->2)::float), 0)
        FROM jsonb_array_elements(raw_json->'floorValuesArray') as elem
      ) as floors_up,
      (
        SELECT COALESCE(SUM((elem->3)::float), 0)
        FROM jsonb_array_elements(raw_json->'floorValuesArray') as elem
      ) as floors_down
    FROM garmin_raw_data
    WHERE endpoint_name = 'floors'
      AND date >= ${cutoff}
      AND (
        SELECT COALESCE(SUM((elem->2)::float), 0)
        FROM jsonb_array_elements(raw_json->'floorValuesArray') as elem
      ) > 0
    ORDER BY date ASC
  `;
  return rows;
}

async function getTrainingTimeOfDay(cutoff: string) {
  const sql = getDb();
  const rows = await sql`
    SELECT
      EXTRACT(HOUR FROM (raw_json->>'startTimeLocal')::timestamp) as hour,
      COUNT(*) as count
    FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
      AND (raw_json->>'startTimeLocal')::timestamp >= ${cutoff}::date
    GROUP BY hour
    ORDER BY hour ASC
  `;
  return rows;
}

async function getActivityHeatmap(cutoff: string) {
  const sql = getDb();
  const rows = await sql`
    SELECT
      LEFT((raw_json->>'startTimeLocal')::text, 10) as date,
      COUNT(*) as count,
      array_agg(DISTINCT raw_json->'activityType'->>'typeKey') as types,
      json_agg(json_build_object(
        'activity_id', activity_id::text,
        'type_key', raw_json->'activityType'->>'typeKey',
        'name', raw_json->>'activityName'
      )) as activities
    FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
      AND (raw_json->>'startTimeLocal')::timestamp >= ${cutoff}::date
    GROUP BY date
    ORDER BY date ASC
  `;

  // Match strength_training activities with Hevy workout IDs
  const gymDates = new Set<string>();
  for (const row of rows) {
    const acts = typeof row.activities === "string" ? JSON.parse(row.activities) : row.activities;
    for (const a of acts) {
      if (a.type_key === "strength_training") {
        gymDates.add(row.date);
      }
    }
  }

  let hevyMap: Record<string, string> = {};
  if (gymDates.size > 0) {
    const hevyRows = await sql`
      SELECT
        raw_json->>'id' as workout_id,
        LEFT((raw_json->>'start_time')::text, 10) as day
      FROM hevy_raw_data
      WHERE endpoint_name = 'workout'
      ORDER BY raw_json->>'start_time' DESC
      LIMIT 200
    `;
    for (const r of hevyRows) {
      if (!hevyMap[r.day]) hevyMap[r.day] = r.workout_id;
    }
  }

  return rows.map((row: any) => {
    const acts = typeof row.activities === "string" ? JSON.parse(row.activities) : row.activities;
    return {
      ...row,
      activities: acts.map((a: any) => ({
        ...a,
        workout_id: a.type_key === "strength_training" ? hevyMap[row.date] || null : null,
      })),
    };
  });
}

async function getLastWorkoutDetail() {
  const sql = getDb();
  const rows = await sql`
    SELECT
      raw_json->>'id' as workout_id,
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
    workoutId: w.workout_id,
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
  other: "Other",
};

// Merge these activity type_keys into a single group for display
const MERGE_TYPES: Record<string, string> = {
  wind_kite_surfing: "kiteboarding_v2",
  resort_skiing_snowboarding_ws: "resort_snowboarding",
  treadmill_running: "running",
  indoor_cycling: "cycling",
  swimming: "lap_swimming",
  open_water_swimming: "lap_swimming",
};

function formatDuration(mins: number) {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range: rangeParam } = await searchParams;
  const rangeDays = rangeToDays(rangeParam);
  const cutoff = new Date(Date.now() - rangeDays * 86400000).toISOString().split("T")[0];
  const floorsCutoff = new Date(Date.now() - Math.min(rangeDays, 90) * 86400000).toISOString().split("T")[0];
  const heatmapCutoff = new Date(Date.now() - Math.min(rangeDays, 365) * 86400000).toISOString().split("T")[0];

  const [health, weekly, workouts, gymFreq, runStats, activityCounts, recentActivities, lastWorkout, weeklyTraining, streak, stepsTrend, fitnessAge, intensityMin, weightTrend, calorieTrend, heatmapData, dayOfWeekData, timeOfDayData, latestSleep, recovery, rhrTrend, stressTrend, floorsTrend] =
    await Promise.all([
      getTodayHealth(),
      getWeeklyAverages(),
      getWorkoutStats(),
      getGymFrequency(cutoff),
      getRunningStats(cutoff),
      getActivityCounts(cutoff),
      getRecentActivities(cutoff),
      getLastWorkoutDetail(),
      getWeeklyTrainingSummary(),
      getTrainingStreak(),
      getStepsTrend(cutoff),
      getFitnessAge(),
      getIntensityMinutes(),
      getWeightTrend(cutoff),
      getCalorieTrend(cutoff),
      getActivityHeatmap(heatmapCutoff),
      getTrainingByDayOfWeek(cutoff),
      getTrainingTimeOfDay(cutoff),
      getLatestSleep(),
      getRecoverySummary(),
      getRestingHRTrend(cutoff),
      getStressTrend(cutoff),
      getFloorsTrend(floorsCutoff),
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
      <div className="flex items-center justify-between mb-8">
        <div>
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
        <TimeRangeSelector />
      </div>

      {/* Clickable Stat Cards with Detail Dialogs */}
      <ClickableStatCards
        primaryCards={[
          {
            metric: "steps",
            title: "Steps",
            value: health?.total_steps?.toLocaleString() ?? "—",
            subtitle: health?.total_distance_meters
              ? `${(health.total_distance_meters / 1000).toFixed(1)} km`
              : undefined,
            icon: <Footprints className="h-4 w-4 text-muted-foreground" />,
          },
          {
            metric: "calories",
            title: "Active Calories",
            value: health?.active_kilocalories?.toLocaleString() ?? "—",
            subtitle: health?.total_kilocalories
              ? `${health.total_kilocalories.toLocaleString()} total`
              : undefined,
            icon: <Flame className="h-4 w-4 text-orange-400" />,
          },
          {
            metric: "rhr",
            title: "Resting HR",
            value: health?.resting_heart_rate ? `${health.resting_heart_rate}` : "—",
            subtitle: health?.min_heart_rate && health?.max_heart_rate
              ? `Range: ${health.min_heart_rate}–${health.max_heart_rate} bpm`
              : undefined,
            icon: <HeartPulse className="h-4 w-4 text-red-400" />,
          },
          {
            metric: "vo2max",
            title: "VO2max",
            value: runStats?.vo2max ? `${Number(runStats.vo2max)}` : "—",
            subtitle: "ml/kg/min",
            icon: <Zap className="h-4 w-4 text-yellow-400" />,
          },
        ]}
        secondaryCards={[
          {
            metric: "sleep",
            title: "Sleep",
            value: (() => {
              const secs = health?.sleep_time_seconds || latestSleep?.total;
              return secs ? `${(secs / 3600).toFixed(1)}h` : "—";
            })(),
            subtitle: latestSleep?.score ? `Score: ${latestSleep.score}` : undefined,
            icon: <Moon className="h-4 w-4 text-indigo-400" />,
          },
          {
            metric: "stress",
            title: "Avg Stress",
            value: health?.avg_stress_level ?? "—",
            subtitle: health?.max_stress_level
              ? `Peak: ${health.max_stress_level}`
              : undefined,
            icon: <Brain className="h-4 w-4 text-yellow-400" />,
          },
          {
            metric: "body_battery",
            title: "Body Battery",
            value: health?.body_battery_charged
              ? `+${health.body_battery_charged}`
              : "—",
            subtitle: health?.body_battery_drained
              ? `−${health.body_battery_drained} drained`
              : undefined,
            icon: <BatteryCharging className="h-4 w-4 text-green-400" />,
          },
          {
            metric: "activities",
            title: "Total Activities",
            value: totalActivities,
            subtitle: `${Number(runStats?.total_km || 0).toFixed(0)} km running`,
            icon: <Activity className="h-4 w-4 text-purple-400" />,
          },
        ]}
      />

      {/* This Week Training Summary (clickable with dialog) */}
      <InteractiveThisWeek
        metrics={(() => {
          const tw = weeklyTraining.this_week;
          const lw = weeklyTraining.last_week;
          if (!tw) return [];
          return [
            { label: "Sessions", value: Number(tw.sessions), prev: lw ? Number(lw.sessions) : null, unit: "" },
            { label: "Duration", value: Number(tw.total_hours), prev: lw ? Number(lw.total_hours) : null, unit: "h" },
            { label: "Distance", value: Number(tw.total_km), prev: lw ? Number(lw.total_km) : null, unit: "km" },
            { label: "Calories", value: Number(tw.total_cal), prev: lw ? Number(lw.total_cal) : null, unit: "kcal" },
          ];
        })()}
        streak={streak}
      />

      {/* Recovery Summary */}
      {(recovery.bodyBattery || recovery.hrv || recovery.readiness) && (
        <ClickableRecoveryCard>
          <Card className="mb-6">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <BatteryCharging className="h-4 w-4 text-green-400" />
                Recovery Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {recovery.readiness && (
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Training Readiness</div>
                    <div className={`text-2xl font-bold ${
                      Number(recovery.readiness.score) >= 70 ? "text-green-400" :
                      Number(recovery.readiness.score) >= 40 ? "text-yellow-400" : "text-red-400"
                    }`}>
                      {recovery.readiness.score}
                    </div>
                    <div className="text-xs text-muted-foreground capitalize">
                      {recovery.readiness.level?.toLowerCase().replace(/_/g, " ")}
                    </div>
                  </div>
                )}
                {recovery.bodyBattery && (
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Body Battery</div>
                    <div className="text-2xl font-bold">
                      +{recovery.bodyBattery.charged}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      −{recovery.bodyBattery.drained} drained
                    </div>
                  </div>
                )}
                {recovery.hrv && (
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">HRV</div>
                    <div className="text-2xl font-bold">
                      {recovery.hrv.last_night ?? recovery.hrv.weekly_avg} ms
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Weekly avg: {recovery.hrv.weekly_avg} ms
                    </div>
                  </div>
                )}
                {recovery.hrv?.status && (
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">HRV Status</div>
                    <div className={`text-2xl font-bold ${
                      recovery.hrv.status === "BALANCED" ? "text-green-400" :
                      recovery.hrv.status === "LOW" ? "text-yellow-400" : "text-blue-400"
                    }`}>
                      {recovery.hrv.status.charAt(0) + recovery.hrv.status.slice(1).toLowerCase()}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </ClickableRecoveryCard>
      )}

      {/* Steps & Calorie Trends */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {(stepsTrend as any[]).length > 0 && (
          <ExpandableChartCard
            title="Daily Steps"
            icon={<Footprints className="h-4 w-4" />}
            subtitle={weekly?.avg_steps ? `7-day avg: ${Number(weekly.avg_steps).toLocaleString()}` : undefined}
          >
            <StepsTrendChart
              data={(stepsTrend as any[]).map((s: any) => ({
                date: s.date,
                steps: Number(s.steps),
              }))}
            />
          </ExpandableChartCard>
        )}

        {(calorieTrend as any[]).length > 0 && (
          <ExpandableChartCard
            title="Daily Calories"
            icon={<Flame className="h-4 w-4 text-orange-400" />}
            subtitle={weekly?.avg_active_cal ? `7-day active avg: ${Number(weekly.avg_active_cal).toLocaleString()} kcal` : undefined}
          >
            <CalorieTrendChart
              data={(calorieTrend as any[]).map((c: any) => ({
                date: c.date,
                active: Number(c.active),
                bmr: Number(c.bmr),
              }))}
            />
          </ExpandableChartCard>
        )}
      </div>

      {/* RHR + Stress Trends */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {(rhrTrend as any[]).length > 0 && (() => {
          const rhrData = (rhrTrend as any[]).filter((r: any) => Number(r.rhr) > 0);
          if (rhrData.length === 0) return null;
          const latest = Number(rhrData[rhrData.length - 1].rhr);
          const avg7d = rhrData.slice(-7).reduce((s: number, r: any) => s + Number(r.rhr), 0) / Math.min(rhrData.length, 7);
          return (
            <ExpandableChartCard
              title="Resting Heart Rate"
              icon={<HeartPulse className="h-4 w-4 text-red-400" />}
              subtitle={`${latest} bpm · avg ${Math.round(avg7d)}`}
            >
              <RHRChart
                data={rhrData.map((r: any) => ({
                  date: r.date,
                  rhr: Number(r.rhr),
                }))}
              />
            </ExpandableChartCard>
          );
        })()}

        {(stressTrend as any[]).length > 0 && (() => {
          const stressData = stressTrend as any[];
          if (stressData.length === 0) return null;
          const latest = Number(stressData[stressData.length - 1].avg_stress);
          const avg7d = stressData.slice(-7).reduce((s: number, r: any) => s + Number(r.avg_stress), 0) / Math.min(stressData.length, 7);
          return (
            <ExpandableChartCard
              title="Stress Trend"
              icon={<Brain className="h-4 w-4 text-yellow-400" />}
              subtitle={`Today: ${latest} · avg ${Math.round(avg7d)}`}
            >
              <StressChart
                data={stressData.map((s: any) => ({
                  date: s.date,
                  avg_stress: Number(s.avg_stress),
                  max_stress: Number(s.max_stress),
                }))}
              />
            </ExpandableChartCard>
          );
        })()}
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
      {(weightTrend as any[]).length > 0 && (() => {
        const weightData = (weightTrend as any[]).filter((w: any) => w.weight_kg > 0);
        if (weightData.length === 0) return null;
        const latest = weightData[weightData.length - 1];
        const subtitleStr = `${Number(latest.weight_kg).toFixed(1)} kg${latest.body_fat ? ` · ${Number(latest.body_fat).toFixed(1)}% BF` : ""}`;
        return (
          <ExpandableChartCard
            title="Body Composition"
            icon={<Weight className="h-4 w-4 text-blue-400" />}
            subtitle={subtitleStr}
            className="mb-6"
          >
            <WeightTrendChart
              data={weightData.map((w: any) => ({
                date: w.date,
                weight_kg: Number(w.weight_kg),
                body_fat: w.body_fat ? Number(w.body_fat) : null,
              }))}
            />
          </ExpandableChartCard>
        );
      })()}

      {/* Floors Climbed */}
      {(floorsTrend as any[]).length > 0 && (
        <Card className="mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Mountain className="h-4 w-4 text-blue-400" />
              Floors Climbed
              {(() => {
                const data = floorsTrend as any[];
                const avg = data.reduce((s: number, d: any) => s + Number(d.floors_up), 0) / data.length;
                const today = data[data.length - 1];
                return (
                  <span className="ml-auto text-xs font-normal">
                    Today: {Math.round(Number(today?.floors_up || 0))} · avg {Math.round(avg)}
                  </span>
                );
              })()}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-2 h-24">
              {(floorsTrend as any[]).map((d: any, i: number) => {
                const up = Number(d.floors_up);
                const maxFloors = Math.max(...(floorsTrend as any[]).map((x: any) => Number(x.floors_up)));
                const pct = maxFloors > 0 ? (up / maxFloors) * 100 : 0;
                const dayLabel = new Date(d.date).toLocaleDateString("en-US", { weekday: "short" });
                return (
                  <div key={i} className="flex-1 flex flex-col items-center">
                    {pct > 40 && (
                      <span className="text-[9px] text-muted-foreground mb-0.5">{Math.round(up)}</span>
                    )}
                    <div className="w-full flex items-end justify-center" style={{ height: "64px" }}>
                      <div
                        className="w-full rounded-t-sm bg-blue-400/70"
                        style={{ height: `${Math.max(pct, up > 0 ? 4 : 0)}%` }}
                        title={`${d.date}: ${Math.round(up)} floors up, ${Math.round(Number(d.floors_down))} down`}
                      />
                    </div>
                    <span className="text-[9px] text-muted-foreground mt-0.5">{dayLabel}</span>
                  </div>
                );
              })}
            </div>
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
                activities: Array.isArray(d.activities)
                  ? d.activities.map((a: any) => ({
                      activity_id: a.activity_id,
                      type_key: a.type_key,
                      name: a.name,
                      workout_id: a.workout_id || undefined,
                    }))
                  : [],
              }))}
            />
          </CardContent>
        </Card>
      )}

      {/* Training Day & Time + Activity Breakdown + Gym Frequency (Interactive) */}
      <InteractiveChartCards
        dayOfWeekData={(dayOfWeekData as any[]).map((r: any) => ({
          dow: Number(r.dow),
          count: Number(r.count),
        }))}
        timeOfDayData={(timeOfDayData as any[]).map((r: any) => ({
          hour: Number(r.hour),
          count: Number(r.count),
        }))}
        activityCounts={mergedCounts}
        gymFrequency={(gymFreq as any[]).map((r: any) => ({
          month: r.month,
          workouts: Number(r.workouts),
        }))}
        workoutStats={{
          total: Number(workouts.total),
          count_7d: Number(workouts.count_7d),
        }}
        streak={streak}
        totalActivities={totalActivities}
      >
        {/* Last Workout (3rd column in the bottom grid) */}
        {lastWorkout?.workoutId ? (
          <ClickableLastWorkout workoutId={lastWorkout.workoutId}>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Last Gym Session
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
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
                <ExpandableExerciseList exercises={lastWorkout.exercises} />
              </CardContent>
            </Card>
          </ClickableLastWorkout>
        ) : (
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
                  <ExpandableExerciseList exercises={lastWorkout.exercises} />
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No workouts yet</p>
              )}
            </CardContent>
          </Card>
        )}
      </InteractiveChartCards>

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
