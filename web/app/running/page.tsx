import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExpandableChartCard } from "@/components/expandable-chart-card";
import { StatCard } from "@/components/stat-card";
import { PaceChart } from "@/components/pace-chart";
import { MileageChart } from "@/components/mileage-chart";

export const metadata: Metadata = { title: "Running" };
import { VO2MaxChart } from "@/components/vo2max-chart";
import { HRPaceChart } from "@/components/hr-pace-chart";
import { CadenceStrideChart } from "@/components/cadence-stride-chart";
import { ClickableRunTable } from "@/components/clickable-run-table";
import { RecentRoutesGallery } from "@/components/recent-routes-gallery";
import { RunHeatmapCard } from "@/components/run-heatmap-card";
import { FitnessScoresChart } from "@/components/fitness-scores-chart";
import { TrainingLoadChart } from "@/components/training-load-chart";
import { TimeRangeSelector } from "@/components/time-range-selector";
import { rangeToDays } from "@/lib/time-ranges";
import { getDb } from "@/lib/db";
import {
  Timer,
  MapPin,
  HeartPulse,
  Zap,
  Trophy,
  Footprints,
  Activity,
  Mountain,
  Gauge,
  BarChart3,
} from "lucide-react";

export const revalidate = 300;

function formatPace(mins: number) {
  const m = Math.floor(mins);
  const s = Math.round((mins - m) * 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

async function getRunningStats(cutoff: string) {
  const sql = getDb();
  const rows = await sql`
    SELECT
      COUNT(*) as total_runs,
      SUM((raw_json->>'distance')::float) / 1000.0 as total_km,
      AVG((raw_json->>'duration')::float / NULLIF((raw_json->>'distance')::float / 1000.0, 0)) / 60.0 as avg_pace,
      AVG((raw_json->>'averageHR')::float) as avg_hr,
      MAX((raw_json->>'vO2MaxValue')::float) as peak_vo2max,
      MAX((raw_json->>'distance')::float) / 1000.0 as longest_run
    FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
      AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
      AND (raw_json->>'startTimeLocal')::timestamp >= ${cutoff}::date
  `;
  return rows[0] || null;
}

async function getPaceHistory(cutoff: string) {
  const sql = getDb();
  const rows = await sql`
    SELECT
      (raw_json->>'startTimeLocal')::text as date,
      (raw_json->>'duration')::float / NULLIF((raw_json->>'distance')::float / 1000.0, 0) / 60.0 as pace,
      (raw_json->>'distance')::float / 1000.0 as distance
    FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
      AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
      AND (raw_json->>'distance')::float > 1000
      AND (raw_json->>'startTimeLocal')::timestamp >= ${cutoff}::date
    ORDER BY (raw_json->>'startTimeLocal')::text ASC
  `;
  return rows;
}

async function getMonthlyMileage(cutoff: string) {
  const sql = getDb();
  const rows = await sql`
    SELECT
      TO_CHAR((raw_json->>'startTimeLocal')::timestamp, 'YYYY-MM') as month,
      COUNT(*) as runs,
      SUM((raw_json->>'distance')::float) / 1000.0 as km
    FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
      AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
      AND (raw_json->>'startTimeLocal')::timestamp >= ${cutoff}::date
    GROUP BY month ORDER BY month ASC
  `;
  return rows;
}

async function getVO2MaxTrend(cutoff: string) {
  const sql = getDb();
  const rows = await sql`
    SELECT DISTINCT ON (LEFT((raw_json->>'startTimeLocal')::text, 10))
      LEFT((raw_json->>'startTimeLocal')::text, 10) as date,
      (raw_json->>'vO2MaxValue')::float as vo2max
    FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
      AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
      AND raw_json->>'vO2MaxValue' IS NOT NULL
      AND (raw_json->>'startTimeLocal')::timestamp >= ${cutoff}::date
    ORDER BY LEFT((raw_json->>'startTimeLocal')::text, 10),
             (raw_json->>'startTimeLocal')::text DESC
  `;
  return rows;
}

async function getHRPaceData(cutoff: string) {
  const sql = getDb();
  const rows = await sql`
    SELECT
      (raw_json->>'startTimeLocal')::text as date,
      (raw_json->>'activityName')::text as name,
      (raw_json->>'duration')::float / NULLIF((raw_json->>'distance')::float / 1000.0, 0) / 60.0 as pace,
      (raw_json->>'averageHR')::float as hr,
      (raw_json->>'distance')::float / 1000.0 as distance
    FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
      AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
      AND (raw_json->>'distance')::float > 1000
      AND (raw_json->>'averageHR')::float > 60
      AND (raw_json->>'duration')::float / NULLIF((raw_json->>'distance')::float / 1000.0, 0) / 60.0 BETWEEN 3.0 AND 10.0
      AND (raw_json->>'startTimeLocal')::timestamp >= ${cutoff}::date
    ORDER BY (raw_json->>'startTimeLocal')::text ASC
  `;
  return rows;
}

async function getCadenceStride(cutoff: string) {
  const sql = getDb();
  const rows = await sql`
    SELECT
      (raw_json->>'startTimeLocal')::text as date,
      ROUND((raw_json->>'averageRunningCadenceInStepsPerMinute')::numeric, 0) as cadence,
      ROUND((raw_json->>'avgStrideLength')::numeric, 0) as stride
    FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
      AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
      AND raw_json->>'averageRunningCadenceInStepsPerMinute' IS NOT NULL
      AND (raw_json->>'averageRunningCadenceInStepsPerMinute')::float >= 120
      AND (raw_json->>'distance')::float > 1000
      AND (raw_json->>'startTimeLocal')::timestamp >= ${cutoff}::date
    ORDER BY (raw_json->>'startTimeLocal')::text ASC
  `;
  return rows;
}

async function getFitnessScores() {
  const sql = getDb();
  const endurance = await sql`
    SELECT
      date::text as date,
      (raw_json->>'overallScore')::int as score,
      (raw_json->>'classification')::int as classification
    FROM garmin_raw_data
    WHERE endpoint_name = 'endurance_score'
      AND date >= CURRENT_DATE - INTERVAL '12 months'
    ORDER BY date ASC
  `;
  const hill = await sql`
    SELECT
      date::text as date,
      (raw_json->>'overallScore')::int as score,
      (raw_json->>'strengthScore')::int as strength,
      (raw_json->>'enduranceScore')::int as endurance
    FROM garmin_raw_data
    WHERE endpoint_name = 'hill_score'
      AND date >= CURRENT_DATE - INTERVAL '12 months'
    ORDER BY date ASC
  `;

  // Merge by date
  const dateMap = new Map<string, { endurance: number | null; hill: number | null }>();
  for (const e of endurance) {
    dateMap.set(e.date, { endurance: Number(e.score), hill: null });
  }
  for (const h of hill) {
    const existing = dateMap.get(h.date) || { endurance: null, hill: null };
    existing.hill = Number(h.score);
    dateMap.set(h.date, existing);
  }

  const latestEndurance = endurance[endurance.length - 1] || null;
  const latestHill = hill[hill.length - 1] || null;

  return {
    trend: Array.from(dateMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, scores]) => ({ date, ...scores })),
    latestEndurance,
    latestHill,
  };
}

async function getTrainingStatus() {
  const sql = getDb();
  // Training status data is nested under a dynamic device ID key
  const rows = await sql`
    WITH status_data AS (
      SELECT
        date::text as date,
        raw_json->'mostRecentTrainingStatus'->'latestTrainingStatusData' as status_map,
        raw_json->'mostRecentVO2Max'->'generic' as vo2max_data,
        raw_json->'mostRecentTrainingLoadBalance'->'metricsTrainingLoadBalanceDTOMap' as load_map
      FROM garmin_raw_data
      WHERE endpoint_name = 'training_status'
        AND raw_json->'mostRecentTrainingStatus' IS NOT NULL
      ORDER BY date DESC
      LIMIT 1
    )
    SELECT
      sd.date,
      (SELECT v->>'trainingStatus' FROM jsonb_each(sd.status_map) AS t(k, v) LIMIT 1) as status_code,
      (SELECT v->>'sport' FROM jsonb_each(sd.status_map) AS t(k, v) LIMIT 1) as sport,
      (SELECT v->>'trainingStatusFeedbackPhrase' FROM jsonb_each(sd.status_map) AS t(k, v) LIMIT 1) as feedback,
      (SELECT v->'acuteTrainingLoadDTO'->>'dailyTrainingLoadAcute' FROM jsonb_each(sd.status_map) AS t(k, v) LIMIT 1) as acute_load,
      (SELECT v->'acuteTrainingLoadDTO'->>'dailyTrainingLoadChronic' FROM jsonb_each(sd.status_map) AS t(k, v) LIMIT 1) as chronic_load,
      (SELECT v->'acuteTrainingLoadDTO'->>'dailyAcuteChronicWorkloadRatio' FROM jsonb_each(sd.status_map) AS t(k, v) LIMIT 1) as acwr,
      (SELECT v->'acuteTrainingLoadDTO'->>'acwrStatus' FROM jsonb_each(sd.status_map) AS t(k, v) LIMIT 1) as acwr_status,
      sd.vo2max_data->>'vo2MaxPreciseValue' as vo2max,
      (SELECT v->>'trainingBalanceFeedbackPhrase' FROM jsonb_each(sd.load_map) AS t(k, v) LIMIT 1) as load_balance
    FROM status_data sd
  `;
  return rows[0] || null;
}

async function getTrainingLoadTrend(cutoff: string) {
  const sql = getDb();
  const rows = await sql`
    SELECT
      date::text as date,
      (SELECT v->'acuteTrainingLoadDTO'->>'dailyTrainingLoadAcute'
       FROM jsonb_each(raw_json->'mostRecentTrainingStatus'->'latestTrainingStatusData') AS t(k, v)
       LIMIT 1)::float as acute,
      (SELECT v->'acuteTrainingLoadDTO'->>'dailyTrainingLoadChronic'
       FROM jsonb_each(raw_json->'mostRecentTrainingStatus'->'latestTrainingStatusData') AS t(k, v)
       LIMIT 1)::float as chronic,
      (SELECT v->'acuteTrainingLoadDTO'->>'dailyAcuteChronicWorkloadRatio'
       FROM jsonb_each(raw_json->'mostRecentTrainingStatus'->'latestTrainingStatusData') AS t(k, v)
       LIMIT 1)::float as acwr
    FROM garmin_raw_data
    WHERE endpoint_name = 'training_status'
      AND raw_json->'mostRecentTrainingStatus' IS NOT NULL
      AND date >= ${cutoff}::date
    ORDER BY date ASC
  `;
  return rows;
}

async function getPersonalRecords() {
  const sql = getDb();

  const [fastest5k, fastest10k, longest, maxHR, maxCal, fastestPace] = await Promise.all([
    // Estimated 5K time (runs >= 5km, best pace → projected 5K time)
    sql`
      SELECT
        (raw_json->>'startTimeLocal')::text as date,
        (raw_json->>'activityName')::text as name,
        (raw_json->>'duration')::float / NULLIF((raw_json->>'distance')::float / 1000.0, 0) / 60.0 as pace,
        (raw_json->>'distance')::float / 1000.0 as distance,
        ((raw_json->>'duration')::float / (raw_json->>'distance')::float) * 5000.0 as est_5k_seconds
      FROM garmin_activity_raw
      WHERE endpoint_name = 'summary'
        AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
        AND (raw_json->>'distance')::float >= 4800
      ORDER BY (raw_json->>'duration')::float / NULLIF((raw_json->>'distance')::float, 0) ASC
      LIMIT 1
    `,
    // Estimated 10K time (runs >= 10km, best pace → projected 10K time)
    sql`
      SELECT
        (raw_json->>'startTimeLocal')::text as date,
        (raw_json->>'activityName')::text as name,
        (raw_json->>'duration')::float / NULLIF((raw_json->>'distance')::float / 1000.0, 0) / 60.0 as pace,
        (raw_json->>'distance')::float / 1000.0 as distance,
        ((raw_json->>'duration')::float / (raw_json->>'distance')::float) * 10000.0 as est_10k_seconds
      FROM garmin_activity_raw
      WHERE endpoint_name = 'summary'
        AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
        AND (raw_json->>'distance')::float >= 9500
      ORDER BY (raw_json->>'duration')::float / NULLIF((raw_json->>'distance')::float, 0) ASC
      LIMIT 1
    `,
    // Longest run
    sql`
      SELECT
        (raw_json->>'startTimeLocal')::text as date,
        (raw_json->>'activityName')::text as name,
        (raw_json->>'distance')::float / 1000.0 as distance,
        (raw_json->>'duration')::float / 60.0 as duration_min
      FROM garmin_activity_raw
      WHERE endpoint_name = 'summary'
        AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
      ORDER BY (raw_json->>'distance')::float DESC
      LIMIT 1
    `,
    // Highest max HR
    sql`
      SELECT
        (raw_json->>'startTimeLocal')::text as date,
        (raw_json->>'activityName')::text as name,
        (raw_json->>'averageHR')::float as avg_hr,
        (raw_json->>'maxHR')::float as max_hr
      FROM garmin_activity_raw
      WHERE endpoint_name = 'summary'
        AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
        AND raw_json->>'maxHR' IS NOT NULL
      ORDER BY (raw_json->>'maxHR')::float DESC
      LIMIT 1
    `,
    // Most calories
    sql`
      SELECT
        (raw_json->>'startTimeLocal')::text as date,
        (raw_json->>'activityName')::text as name,
        (raw_json->>'calories')::float as calories,
        (raw_json->>'distance')::float / 1000.0 as distance
      FROM garmin_activity_raw
      WHERE endpoint_name = 'summary'
        AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
        AND raw_json->>'calories' IS NOT NULL
      ORDER BY (raw_json->>'calories')::float DESC
      LIMIT 1
    `,
    // Fastest single-km pace (runs > 3km for quality filter)
    sql`
      SELECT
        (raw_json->>'startTimeLocal')::text as date,
        (raw_json->>'activityName')::text as name,
        (raw_json->>'duration')::float / NULLIF((raw_json->>'distance')::float / 1000.0, 0) / 60.0 as pace,
        (raw_json->>'distance')::float / 1000.0 as distance
      FROM garmin_activity_raw
      WHERE endpoint_name = 'summary'
        AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
        AND (raw_json->>'distance')::float > 3000
      ORDER BY (raw_json->>'duration')::float / NULLIF((raw_json->>'distance')::float, 0) ASC
      LIMIT 1
    `,
  ]);

  return {
    fastest5k: fastest5k[0] || null,
    fastest10k: fastest10k[0] || null,
    longest: longest[0] || null,
    maxHR: maxHR[0] || null,
    maxCal: maxCal[0] || null,
    fastestPace: fastestPace[0] || null,
  };
}

async function getOverallHRDistribution(cutoff: string) {
  const sql = getDb();
  const rows = await sql`
    SELECT
      CASE
        WHEN (raw_json->>'averageHR')::float < 120 THEN 'Zone 1 (Recovery)'
        WHEN (raw_json->>'averageHR')::float < 140 THEN 'Zone 2 (Easy)'
        WHEN (raw_json->>'averageHR')::float < 155 THEN 'Zone 3 (Aerobic)'
        WHEN (raw_json->>'averageHR')::float < 170 THEN 'Zone 4 (Threshold)'
        ELSE 'Zone 5 (Max)'
      END as zone,
      COUNT(*) as count,
      ROUND(AVG((raw_json->>'duration')::float / 60)::numeric) as avg_duration,
      ROUND(AVG((raw_json->>'distance')::float / 1000)::numeric, 1) as avg_km,
      CASE
        WHEN (raw_json->>'averageHR')::float < 120 THEN 1
        WHEN (raw_json->>'averageHR')::float < 140 THEN 2
        WHEN (raw_json->>'averageHR')::float < 155 THEN 3
        WHEN (raw_json->>'averageHR')::float < 170 THEN 4
        ELSE 5
      END as sort_order
    FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
      AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
      AND raw_json->>'averageHR' IS NOT NULL
      AND (raw_json->>'distance')::float > 1000
      AND (raw_json->>'startTimeLocal')::timestamp >= ${cutoff}::date
    GROUP BY zone, sort_order
    ORDER BY sort_order ASC
  `;
  return rows;
}

async function getRecentRuns(cutoff: string) {
  const sql = getDb();
  const rows = await sql`
    SELECT
      s.activity_id::text as activity_id,
      (s.raw_json->>'startTimeLocal')::text as date,
      (s.raw_json->>'activityName')::text as name,
      (s.raw_json->>'distance')::float / 1000.0 as distance,
      (s.raw_json->>'duration')::float / 60.0 as duration_min,
      (s.raw_json->>'duration')::float / NULLIF((s.raw_json->>'distance')::float / 1000.0, 0) / 60.0 as pace,
      (s.raw_json->>'averageHR')::float as avg_hr,
      (s.raw_json->>'calories')::float as calories,
      (s.raw_json->>'elevationGain')::float as elev_gain,
      w.raw_json->>'temp' as temp_f,
      w.raw_json->'weatherTypeDTO'->>'desc' as weather_desc
    FROM garmin_activity_raw s
    LEFT JOIN LATERAL (
      SELECT raw_json FROM garmin_activity_raw
      WHERE activity_id = s.activity_id AND endpoint_name = 'weather'
      LIMIT 1
    ) w ON true
    WHERE s.endpoint_name = 'summary'
      AND s.raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
      AND (s.raw_json->>'startTimeLocal')::timestamp >= ${cutoff}::date
    ORDER BY (s.raw_json->>'startTimeLocal')::text DESC
    LIMIT 20
  `;
  return rows;
}

async function getShoeMileage() {
  const sql = getDb();
  const rows = await sql`
    WITH running_gear AS (
      SELECT
        s.activity_id,
        (s.raw_json->>'distance')::float / 1000.0 as distance_km,
        g.raw_json->0->>'gearPk' as gear_pk,
        g.raw_json->0->>'displayName' as display_name,
        g.raw_json->0->>'customMakeModel' as custom_name,
        g.raw_json->0->>'gearStatusName' as status,
        (g.raw_json->0->>'maximumMeters')::float / 1000.0 as max_km
      FROM garmin_activity_raw s
      JOIN garmin_activity_raw g ON g.activity_id = s.activity_id AND g.endpoint_name = 'gear'
      WHERE s.endpoint_name = 'summary'
        AND s.raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
        AND g.raw_json->0->>'gearTypeName' = 'Shoes'
    )
    SELECT
      gear_pk,
      COALESCE(custom_name, display_name) as shoe_name,
      status,
      max_km,
      COUNT(*) as runs,
      SUM(distance_km) as total_km,
      MIN(distance_km) as shortest_km,
      MAX(distance_km) as longest_km
    FROM running_gear
    WHERE gear_pk IS NOT NULL
    GROUP BY gear_pk, shoe_name, status, max_km
    ORDER BY total_km DESC
  `;
  return rows;
}

async function getSplitAnalysis(cutoff: string) {
  const sql = getDb();
  const rows = await sql`
    WITH recent_activities AS (
      SELECT activity_id
      FROM garmin_activity_raw
      WHERE endpoint_name = 'summary'
        AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
        AND (raw_json->>'startTimeLocal')::timestamp >= ${cutoff}::date
    ),
    split_data AS (
      SELECT
        s.activity_id,
        (lap->>'lapIndex')::int as lap_index,
        (lap->>'distance')::float as distance,
        (lap->>'duration')::float as duration,
        (lap->>'averageHR')::float as avg_hr,
        (lap->>'averageRunCadence')::float * 2 as cadence,
        (lap->>'averagePower')::float as power
      FROM garmin_activity_raw s,
        jsonb_array_elements(s.raw_json->'lapDTOs') as lap
      WHERE s.endpoint_name = 'splits'
        AND s.activity_id IN (SELECT activity_id FROM recent_activities)
        AND (lap->>'distance')::float BETWEEN 800 AND 1200
        AND (lap->>'duration')::float > 0
    )
    SELECT
      lap_index as km,
      COUNT(*) as runs,
      AVG(duration / NULLIF(distance / 1000.0, 0) / 60.0) as avg_pace,
      AVG(avg_hr) as avg_hr,
      AVG(cadence) as avg_cadence,
      AVG(power) as avg_power,
      PERCENTILE_CONT(0.1) WITHIN GROUP (ORDER BY duration / NULLIF(distance / 1000.0, 0) / 60.0) as fast_pace,
      PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY duration / NULLIF(distance / 1000.0, 0) / 60.0) as slow_pace
    FROM split_data
    WHERE lap_index < 15
    GROUP BY lap_index
    HAVING COUNT(*) >= 10
    ORDER BY lap_index ASC
  `;
  return rows;
}

async function getBestSplits(cutoff: string) {
  const sql = getDb();
  const rows = await sql`
    WITH recent_activities AS (
      SELECT activity_id
      FROM garmin_activity_raw
      WHERE endpoint_name = 'summary'
        AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
        AND (raw_json->>'startTimeLocal')::timestamp >= ${cutoff}::date
    ),
    split_data AS (
      SELECT
        s.activity_id,
        (lap->>'lapIndex')::int as lap_index,
        (lap->>'distance')::float as distance,
        (lap->>'duration')::float as duration,
        (lap->>'averageHR')::float as avg_hr,
        (lap->>'averageRunCadence')::float * 2 as cadence
      FROM garmin_activity_raw s,
        jsonb_array_elements(s.raw_json->'lapDTOs') as lap
      WHERE s.endpoint_name = 'splits'
        AND s.activity_id IN (SELECT activity_id FROM recent_activities)
        AND (lap->>'distance')::float BETWEEN 800 AND 1200
        AND (lap->>'duration')::float > 0
    ),
    with_pace AS (
      SELECT *,
        duration / NULLIF(distance / 1000.0, 0) / 60.0 as pace
      FROM split_data
    )
    SELECT
      wp.activity_id,
      wp.lap_index as km,
      wp.pace,
      wp.avg_hr,
      wp.cadence,
      (sm.raw_json->>'startTimeLocal')::text as date,
      (sm.raw_json->>'activityName')::text as activity_name
    FROM with_pace wp
    JOIN garmin_activity_raw sm ON sm.activity_id = wp.activity_id AND sm.endpoint_name = 'summary'
    WHERE wp.pace BETWEEN 2.5 AND 10
    ORDER BY wp.pace ASC
    LIMIT 5
  `;
  return rows;
}

export default async function RunningPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range: rangeParam } = await searchParams;
  const rangeDays = rangeToDays(rangeParam);
  // Cap at 2 years to prevent Neon free tier OOM on large JSONB scans
  const cutoffDays = Math.min(rangeDays, 730);
  const cutoff = new Date(Date.now() - cutoffDays * 86400000).toISOString().split("T")[0];

  const [stats, paceHistory, mileage, vo2max, hrPaceData, cadenceStride, records, recentRuns, fitnessScores, trainingStatus, hrDistribution, shoeMileage, splitAnalysis, bestSplits, trainingLoadTrend] =
    await Promise.all([
      getRunningStats(cutoff),
      getPaceHistory(cutoff),
      getMonthlyMileage(cutoff),
      getVO2MaxTrend(cutoff),
      getHRPaceData(cutoff),
      getCadenceStride(cutoff),
      getPersonalRecords(),
      getRecentRuns(cutoff),
      getFitnessScores(),
      getTrainingStatus(),
      getOverallHRDistribution(cutoff),
      getShoeMileage(),
      getSplitAnalysis(cutoff),
      getBestSplits(cutoff),
      getTrainingLoadTrend(cutoff),
    ]);

  return (
    <div className="container mx-auto px-3 sm:px-6 py-4 sm:py-8 max-w-7xl">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Running</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {stats?.total_runs
              ? `${Number(stats.total_runs)} runs tracked · ${Number(stats.total_km).toFixed(0)} km total`
              : "No runs tracked yet."}
          </p>
        </div>
        <TimeRangeSelector />
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard
          title="Total Distance"
          value={stats?.total_km ? `${Number(stats.total_km).toFixed(0)} km` : "—"}
          subtitle={`${Number(stats?.total_runs || 0)} runs`}
          icon={<MapPin className="h-4 w-4 text-blue-400" />}
        />
        <StatCard
          title="Avg Pace"
          value={stats?.avg_pace ? formatPace(Number(stats.avg_pace)) + "/km" : "—"}
          icon={<Timer className="h-4 w-4 text-green-400" />}
        />
        <StatCard
          title="Avg Heart Rate"
          value={stats?.avg_hr ? `${Math.round(Number(stats.avg_hr))} bpm` : "—"}
          icon={<HeartPulse className="h-4 w-4 text-red-400" />}
        />
        <StatCard
          title="VO2max"
          value={stats?.peak_vo2max ? `${Number(stats.peak_vo2max).toFixed(1)}` : "—"}
          subtitle="ml/kg/min"
          icon={<Zap className="h-4 w-4 text-yellow-400" />}
        />
      </div>

      {/* Training Status + Training Load (most actionable — "should I run today?") */}
      {trainingStatus && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Gauge className="h-4 w-4 text-blue-400" />
              Training Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div className="text-xs text-muted-foreground mb-1">Status</div>
                <div className="text-lg font-bold">
                  {(() => {
                    const statusMap: Record<string, { label: string; color: string }> = {
                      "7": { label: "Productive", color: "text-green-400" },
                      "6": { label: "Maintaining", color: "text-blue-400" },
                      "5": { label: "Recovery", color: "text-yellow-400" },
                      "4": { label: "Unproductive", color: "text-orange-400" },
                      "3": { label: "Detraining", color: "text-red-400" },
                      "2": { label: "Peaking", color: "text-purple-400" },
                      "1": { label: "Overreaching", color: "text-red-400" },
                    };
                    const s = statusMap[trainingStatus.status_code] || { label: trainingStatus.feedback || "Unknown", color: "text-muted-foreground" };
                    return <span className={s.color}>{s.label}</span>;
                  })()}
                </div>
                <div className="text-xs text-muted-foreground capitalize">
                  {trainingStatus.sport?.toLowerCase()}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">VO2 Max</div>
                <div className="text-lg font-bold">
                  {trainingStatus.vo2max ? Number(trainingStatus.vo2max).toFixed(1) : "—"}
                </div>
                <div className="text-xs text-muted-foreground">ml/kg/min</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Training Load</div>
                <div className="text-lg font-bold">
                  {trainingStatus.acute_load ? Math.round(Number(trainingStatus.acute_load)) : "—"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {trainingStatus.chronic_load ? `Chronic: ${Math.round(Number(trainingStatus.chronic_load))}` : ""}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">ACWR</div>
                <div className="text-lg font-bold">
                  {trainingStatus.acwr ? Number(trainingStatus.acwr).toFixed(2) : "—"}
                </div>
                <div className={`text-xs capitalize ${
                  trainingStatus.acwr_status === "OPTIMAL" ? "text-green-400" :
                  trainingStatus.acwr_status === "HIGH" ? "text-yellow-400" : "text-muted-foreground"
                }`}>
                  {trainingStatus.acwr_status?.toLowerCase()}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Training Load Trend */}
      {(trainingLoadTrend as any[]).length > 2 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Activity className="h-4 w-4 text-orange-400" />
              Training Load Trend
              <span className="ml-auto text-xs font-normal flex items-center gap-3">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-500" />Acute</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400" />Chronic</span>
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TrainingLoadChart data={(trainingLoadTrend as any[]).map((d: any) => ({
              date: d.date,
              acute: d.acute ? Number(d.acute) : null,
              chronic: d.chronic ? Number(d.chronic) : null,
              acwr: d.acwr ? Number(d.acwr) : null,
            }))} />
          </CardContent>
        </Card>
      )}

      {/* Pace + Monthly Mileage */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <ExpandableChartCard title="Pace Progression">
          <PaceChart data={paceHistory as any} />
        </ExpandableChartCard>

        <ExpandableChartCard title="Monthly Mileage">
          <MileageChart data={mileage as any} />
        </ExpandableChartCard>
      </div>

      {/* Route Heatmap + Recent Routes */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <MapPin className="h-4 w-4 text-blue-400" />
            Route Heatmap
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-hidden rounded-b-lg">
          <RunHeatmapCard />
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <MapPin className="h-4 w-4 text-blue-400" />
            Recent Routes
          </CardTitle>
        </CardHeader>
        <CardContent>
          <RecentRoutesGallery />
        </CardContent>
      </Card>

      {/* VO2max + HR vs Pace */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <ExpandableChartCard title="VO2max Trend">
          <VO2MaxChart data={vo2max as any} />
        </ExpandableChartCard>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <HeartPulse className="h-4 w-4 text-red-400" />
              Heart Rate vs Pace
            </CardTitle>
          </CardHeader>
          <CardContent>
            <HRPaceChart data={hrPaceData as any} />
          </CardContent>
        </Card>
      </div>

      {/* Cadence & Stride */}
      <ExpandableChartCard title="Cadence & Stride Length" className="mb-6">
        <CadenceStrideChart
          data={(cadenceStride as any[]).map((c: any) => ({
            date: c.date,
            cadence: Number(c.cadence),
            stride: Number(c.stride),
          }))}
        />
      </ExpandableChartCard>

      {/* Training Intensity Distribution */}
      {(hrDistribution as any[]).length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <HeartPulse className="h-4 w-4 text-red-400" />
              Training Intensity Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const zones = hrDistribution as any[];
              const total = zones.reduce((s: number, z: any) => s + Number(z.count), 0);
              const zoneColors = [
                "bg-blue-400", "bg-green-400", "bg-yellow-400", "bg-orange-400", "bg-red-400",
              ];
              return (
                <div className="space-y-3">
                  <div className="flex h-6 rounded-full overflow-hidden">
                    {zones.map((z: any, i: number) => {
                      const pct = total > 0 ? (Number(z.count) / total) * 100 : 0;
                      if (pct < 1) return null;
                      return (
                        <div
                          key={z.zone}
                          className={`${zoneColors[i]} flex items-center justify-center`}
                          style={{ width: `${pct}%` }}
                          title={`${z.zone}: ${z.count} runs (${pct.toFixed(0)}%)`}
                        >
                          {pct > 8 && <span className="text-[10px] font-bold text-black/70">{pct.toFixed(0)}%</span>}
                        </div>
                      );
                    })}
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    {zones.map((z: any, i: number) => (
                      <div key={z.zone} className="text-center">
                        <div className="flex items-center justify-center gap-1.5 mb-1">
                          <span className={`w-2.5 h-2.5 rounded-full ${zoneColors[i]}`} />
                          <span className="text-xs font-medium">{z.zone.split(" ")[0]} {z.zone.split(" ")[1]}</span>
                        </div>
                        <div className="text-lg font-bold">{Number(z.count)}</div>
                        <div className="text-[10px] text-muted-foreground">
                          avg {z.avg_km} km · {z.avg_duration}m
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </CardContent>
        </Card>
      )}

      {/* Per-KM Split Analysis */}
      {(splitAnalysis as any[]).length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-cyan-400" />
              Per-KM Split Analysis
              <span className="ml-auto text-xs font-normal text-muted-foreground">
                avg across all runs
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Split pace bars */}
              <div className="space-y-1.5">
                {(() => {
                  const splits = splitAnalysis as any[];
                  const paces = splits.map((s: any) => Number(s.avg_pace));
                  const minPace = Math.min(...paces);
                  const maxPace = Math.max(...paces);
                  const range = maxPace - minPace || 1;

                  return splits.map((s: any) => {
                    const pace = Number(s.avg_pace);
                    const hr = s.avg_hr ? Math.round(Number(s.avg_hr)) : null;
                    const cadence = s.avg_cadence ? Math.round(Number(s.avg_cadence)) : null;
                    const power = s.avg_power ? Math.round(Number(s.avg_power)) : null;
                    // Normalize: fastest pace = 100%, slowest = 30%
                    const normalizedWidth = 100 - ((pace - minPace) / range) * 70;
                    // Color: green for fastest splits, yellow for mid, orange for slowest
                    const relPos = (pace - minPace) / range;
                    const barColor = relPos < 0.33 ? "bg-emerald-500" : relPos < 0.66 ? "bg-yellow-500" : "bg-orange-500";

                    return (
                      <div key={s.km} className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground w-10 text-right font-mono">
                          km {s.km}
                        </span>
                        <div className="flex-1 flex items-center gap-1">
                          <div className="flex-1 h-5 bg-muted/30 rounded-sm overflow-hidden">
                            <div
                              className={`h-full ${barColor} rounded-sm transition-all`}
                              style={{ width: `${normalizedWidth}%` }}
                            />
                          </div>
                          <span className="text-[10px] font-mono text-muted-foreground w-14 text-right shrink-0">
                            {formatPace(pace)}/km
                          </span>
                        </div>
                        <div className="hidden md:flex items-center gap-3 text-[10px] text-muted-foreground w-36">
                          {hr && <span>{hr} bpm</span>}
                          {cadence && <span>{cadence} spm</span>}
                          {power && <span>{power}W</span>}
                        </div>
                        <span className="text-[10px] text-muted-foreground w-12 text-right">
                          {Number(s.runs)} runs
                        </span>
                      </div>
                    );
                  });
                })()}
              </div>

              {/* Best single KM splits */}
              {(bestSplits as any[]).length > 0 && (
                <div className="pt-3 border-t border-border/50">
                  <div className="text-xs font-medium text-muted-foreground mb-2">Fastest Single KM Splits</div>
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                    {(bestSplits as any[]).map((s: any, i: number) => (
                      <div key={i} className="flex items-center gap-2 p-2 bg-muted/20 rounded">
                        <span className={`text-sm font-bold ${i === 0 ? "text-amber-400" : i === 1 ? "text-slate-300" : "text-amber-700"}`}>
                          #{i + 1}
                        </span>
                        <div>
                          <div className="text-sm font-medium font-mono">{formatPace(Number(s.pace))}/km</div>
                          <div className="text-[10px] text-muted-foreground">
                            km {s.km} · {s.activity_name?.slice(0, 15)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Fitness Scores */}
      {fitnessScores.trend.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Mountain className="h-4 w-4 text-amber-400" />
              Fitness Scores
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div>
                <div className="text-xs text-muted-foreground">Endurance Score</div>
                <div className="text-2xl font-bold">
                  {fitnessScores.latestEndurance
                    ? Number(fitnessScores.latestEndurance.score).toLocaleString()
                    : "—"}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Hill Score</div>
                <div className="text-2xl font-bold">
                  {fitnessScores.latestHill?.score ?? "—"}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Hill Strength</div>
                <div className="text-2xl font-bold">
                  {(fitnessScores.latestHill as any)?.strength ?? "—"}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Hill Endurance</div>
                <div className="text-2xl font-bold">
                  {(fitnessScores.latestHill as any)?.endurance ?? "—"}
                </div>
              </div>
            </div>
            <FitnessScoresChart data={fitnessScores.trend} />
          </CardContent>
        </Card>
      )}

      {/* Personal Records */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Trophy className="h-4 w-4 text-yellow-400" />
            Personal Records
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Race Time Estimates */}
          {(records.fastest5k || records.fastest10k) && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6 pb-6 border-b border-border/50">
              {records.fastest5k && (
                <div className="text-center">
                  <div className="text-xs text-muted-foreground mb-1">Est. 5K Time</div>
                  <div className="text-2xl font-bold text-green-400">
                    {(() => {
                      const secs = Number(records.fastest5k.est_5k_seconds);
                      const m = Math.floor(secs / 60);
                      const s = Math.round(secs % 60);
                      return `${m}:${s.toString().padStart(2, "0")}`;
                    })()}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatPace(Number(records.fastest5k.pace))}/km ·{" "}
                    {new Date(records.fastest5k.date).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </div>
                </div>
              )}
              {records.fastest10k && (
                <div className="text-center">
                  <div className="text-xs text-muted-foreground mb-1">Est. 10K Time</div>
                  <div className="text-2xl font-bold text-blue-400">
                    {(() => {
                      const secs = Number(records.fastest10k.est_10k_seconds);
                      const m = Math.floor(secs / 60);
                      const s = Math.round(secs % 60);
                      return `${m}:${s.toString().padStart(2, "0")}`;
                    })()}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatPace(Number(records.fastest10k.pace))}/km ·{" "}
                    {new Date(records.fastest10k.date).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </div>
                </div>
              )}
              {records.fastestPace && (
                <div className="text-center">
                  <div className="text-xs text-muted-foreground mb-1">Best Avg Pace</div>
                  <div className="text-2xl font-bold text-amber-400">
                    {formatPace(Number(records.fastestPace.pace))}/km
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {Number(records.fastestPace.distance).toFixed(1)} km ·{" "}
                    {new Date(records.fastestPace.date).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
          {/* Other Records */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {records.longest && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">Longest Run</div>
                <div className="text-lg font-bold">
                  {Number(records.longest.distance).toFixed(1)} km
                </div>
                <div className="text-xs text-muted-foreground">
                  {Math.round(Number(records.longest.duration_min))} min ·{" "}
                  {new Date(records.longest.date).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    ...(new Date(records.longest.date).getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}),
                  })}
                </div>
              </div>
            )}
            {records.maxHR && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">Max Heart Rate</div>
                <div className="text-lg font-bold">
                  {Math.round(Number(records.maxHR.max_hr))} bpm
                </div>
                <div className="text-xs text-muted-foreground">
                  Avg {Math.round(Number(records.maxHR.avg_hr))} bpm ·{" "}
                  {new Date(records.maxHR.date).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    ...(new Date(records.maxHR.date).getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}),
                  })}
                </div>
              </div>
            )}
            {records.maxCal && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">Most Calories</div>
                <div className="text-lg font-bold">
                  {Math.round(Number(records.maxCal.calories))} kcal
                </div>
                <div className="text-xs text-muted-foreground">
                  {Number(records.maxCal.distance).toFixed(1)} km ·{" "}
                  {new Date(records.maxCal.date).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    ...(new Date(records.maxCal.date).getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}),
                  })}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Shoe Mileage Tracker */}
      {(shoeMileage as any[]).length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Footprints className="h-4 w-4 text-emerald-400" />
              Shoe Mileage
              <span className="ml-auto text-xs font-normal">
                {(shoeMileage as any[]).length} {(shoeMileage as any[]).length === 1 ? "pair" : "pairs"} tracked
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {(shoeMileage as any[]).map((shoe: any) => {
                const totalKm = Number(shoe.total_km);
                const maxKm = shoe.max_km ? Number(shoe.max_km) : null;
                const pct = maxKm ? (totalKm / maxKm) * 100 : null;
                const isActive = shoe.status === "active";
                const wornPct = pct ?? 0;
                const barColor = wornPct > 80 ? "bg-red-500" : wornPct > 60 ? "bg-yellow-500" : "bg-emerald-500";
                return (
                  <div key={shoe.gear_pk}>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-medium ${isActive ? "" : "text-muted-foreground line-through"}`}>
                          {shoe.shoe_name}
                        </span>
                        {!isActive && (
                          <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">retired</span>
                        )}
                        {isActive && pct && pct >= 100 && (
                          <span className="text-[10px] text-red-400 bg-red-400/10 px-1.5 py-0.5 rounded font-medium">Replace</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {Number(shoe.runs)} runs · {totalKm.toFixed(0)} km
                      </div>
                    </div>
                    {maxKm && (
                      <div className="h-2 bg-muted rounded-full overflow-hidden mb-1">
                        <div
                          className={`h-full ${barColor} rounded-full transition-all`}
                          style={{ width: `${Math.min(pct!, 100)}%` }}
                        />
                      </div>
                    )}
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      {maxKm ? (
                        <>
                          <span>{totalKm.toFixed(0)} / {maxKm.toFixed(0)} km ({wornPct.toFixed(0)}%)</span>
                          <span className={totalKm > maxKm ? "text-red-400" : ""}>
                            {totalKm > maxKm
                              ? `${(totalKm - maxKm).toFixed(0)} km over limit`
                              : `${(maxKm - totalKm).toFixed(0)} km remaining`}
                          </span>
                        </>
                      ) : (
                        <span>{totalKm.toFixed(0)} km total</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Runs Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Footprints className="h-4 w-4" />
            Recent Runs
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ClickableRunTable
            runs={(recentRuns as any[]).map((r: any) => ({
              activity_id: r.activity_id,
              date: r.date,
              name: r.name,
              distance: Number(r.distance),
              duration_min: Number(r.duration_min),
              pace: r.pace ? Number(r.pace) : null,
              avg_hr: r.avg_hr ? Number(r.avg_hr) : null,
              calories: r.calories ? Number(r.calories) : null,
              temp_c: r.temp_f ? Math.round((Number(r.temp_f) - 32) * 5 / 9) : null,
              weather_desc: r.weather_desc || null,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
