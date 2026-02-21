import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/stat-card";
import { PaceChart } from "@/components/pace-chart";
import { MileageChart } from "@/components/mileage-chart";
import { HRZoneChart } from "@/components/hr-zone-chart";
import { VO2MaxChart } from "@/components/vo2max-chart";
import { HRPaceChart } from "@/components/hr-pace-chart";
import { WeeklyDistanceChart } from "@/components/weekly-distance-chart";
import { CadenceStrideChart } from "@/components/cadence-stride-chart";
import { ClickableRunTable } from "@/components/clickable-run-table";
import { FitnessScoresChart } from "@/components/fitness-scores-chart";
import { TrainingLoadChart } from "@/components/training-load-chart";
import { YearlyMileageChart } from "@/components/yearly-mileage-chart";
import { TimeRangeSelector } from "@/components/time-range-selector";
import { rangeToDays } from "@/lib/time-ranges";
import { getDb } from "@/lib/db";
import {
  Timer,
  MapPin,
  HeartPulse,
  Zap,
  Trophy,
  TrendingUp,
  Footprints,
  Activity,
  Mountain,
  Gauge,
  BarChart3,
  Thermometer,
  Cloud,
} from "lucide-react";

export const revalidate = 300;

function formatPace(mins: number) {
  const m = Math.floor(mins);
  const s = Math.round((mins - m) * 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

async function getRunningStats(rangeDays: number) {
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
      AND (raw_json->>'startTimeLocal')::timestamp >= CURRENT_DATE - make_interval(days => ${rangeDays})
  `;
  return rows[0] || null;
}

async function getPaceHistory(rangeDays: number) {
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
      AND (raw_json->>'startTimeLocal')::timestamp >= CURRENT_DATE - make_interval(days => ${rangeDays})
    ORDER BY (raw_json->>'startTimeLocal')::text ASC
  `;
  return rows;
}

async function getMonthlyMileage(rangeDays: number) {
  const sql = getDb();
  const rows = await sql`
    SELECT
      TO_CHAR((raw_json->>'startTimeLocal')::timestamp, 'YYYY-MM') as month,
      COUNT(*) as runs,
      SUM((raw_json->>'distance')::float) / 1000.0 as km
    FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
      AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
      AND (raw_json->>'startTimeLocal')::timestamp >= CURRENT_DATE - make_interval(days => ${rangeDays})
    GROUP BY month ORDER BY month ASC
  `;
  return rows;
}

async function getVO2MaxTrend(rangeDays: number) {
  const sql = getDb();
  const rows = await sql`
    SELECT DISTINCT ON (LEFT((raw_json->>'startTimeLocal')::text, 10))
      LEFT((raw_json->>'startTimeLocal')::text, 10) as date,
      (raw_json->>'vO2MaxValue')::float as vo2max
    FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
      AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
      AND raw_json->>'vO2MaxValue' IS NOT NULL
      AND (raw_json->>'startTimeLocal')::timestamp >= CURRENT_DATE - make_interval(days => ${rangeDays})
    ORDER BY LEFT((raw_json->>'startTimeLocal')::text, 10),
             (raw_json->>'startTimeLocal')::text DESC
  `;
  return rows;
}

async function getLatestHRZones() {
  const sql = getDb();
  // Get the latest running activity ID
  const latest = await sql`
    SELECT activity_id
    FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
      AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
    ORDER BY (raw_json->>'startTimeLocal')::text DESC
    LIMIT 1
  `;
  if (!latest[0]) return [];

  const rows = await sql`
    SELECT raw_json
    FROM garmin_activity_raw
    WHERE endpoint_name = 'hr_zones' AND activity_id = ${latest[0].activity_id}
  `;
  if (!rows[0]) return [];

  // raw_json is a list of zone objects
  const zones = rows[0].raw_json;
  if (!Array.isArray(zones)) return [];

  return zones.map((z: any) => ({
    zone: z.zoneNumber,
    seconds: z.secsInZone || 0,
    low: z.zoneLowBoundary || 0,
    high: z.zoneHighBoundary || 999,
  }));
}

async function getHRPaceData(rangeDays: number) {
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
      AND (raw_json->>'startTimeLocal')::timestamp >= CURRENT_DATE - make_interval(days => ${rangeDays})
    ORDER BY (raw_json->>'startTimeLocal')::text ASC
  `;
  return rows;
}

async function getWeeklyDistance(rangeDays: number) {
  const weekDays = Math.min(rangeDays, 365);
  const sql = getDb();
  const rows = await sql`
    SELECT
      TO_CHAR(DATE_TRUNC('week', (raw_json->>'startTimeLocal')::timestamp), 'YYYY-MM-DD') as week,
      COUNT(*) as runs,
      SUM((raw_json->>'distance')::float) / 1000.0 as km
    FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
      AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
      AND (raw_json->>'startTimeLocal')::timestamp >= CURRENT_DATE - make_interval(days => ${weekDays})
    GROUP BY week ORDER BY week ASC
  `;
  return rows;
}

async function getCadenceStride(rangeDays: number) {
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
      AND (raw_json->>'startTimeLocal')::timestamp >= CURRENT_DATE - make_interval(days => ${rangeDays})
    ORDER BY (raw_json->>'startTimeLocal')::text ASC
  `;
  return rows;
}

async function getTrainingEffects(rangeDays: number) {
  const sql = getDb();
  const rows = await sql`
    SELECT
      (raw_json->>'startTimeLocal')::text as date,
      (raw_json->>'activityName')::text as name,
      ROUND((raw_json->>'aerobicTrainingEffect')::numeric, 1) as aerobic_te,
      ROUND((raw_json->>'anaerobicTrainingEffect')::numeric, 1) as anaerobic_te,
      (raw_json->>'distance')::float / 1000.0 as distance
    FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
      AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
      AND raw_json->>'aerobicTrainingEffect' IS NOT NULL
      AND (raw_json->>'startTimeLocal')::timestamp >= CURRENT_DATE - make_interval(days => ${rangeDays})
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

async function getTrainingLoadTrend(rangeDays: number) {
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
      AND date >= CURRENT_DATE - make_interval(days => ${rangeDays})
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

async function getYearlyRunningStats() {
  const sql = getDb();
  const rows = await sql`
    SELECT
      EXTRACT(YEAR FROM (raw_json->>'startTimeLocal')::timestamp)::int as year,
      COUNT(*) as runs,
      SUM((raw_json->>'distance')::float) / 1000.0 as total_km,
      AVG((raw_json->>'duration')::float / NULLIF((raw_json->>'distance')::float / 1000.0, 0) / 60.0) as avg_pace,
      AVG((raw_json->>'averageHR')::float) as avg_hr,
      MAX((raw_json->>'distance')::float) / 1000.0 as longest_km,
      SUM((raw_json->>'calories')::float) as total_cal
    FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
      AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
      AND (raw_json->>'distance')::float > 500
    GROUP BY year
    ORDER BY year DESC
  `;
  return rows;
}

async function getPaceDistribution(rangeDays: number) {
  const sql = getDb();
  const rows = await sql`
    WITH paces AS (
      SELECT
        (raw_json->>'duration')::float / NULLIF((raw_json->>'distance')::float / 1000.0, 0) / 60.0 as pace
      FROM garmin_activity_raw
      WHERE endpoint_name = 'summary'
        AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
        AND (raw_json->>'distance')::float > 1000
        AND (raw_json->>'startTimeLocal')::timestamp >= CURRENT_DATE - make_interval(days => ${rangeDays})
    )
    SELECT
      CASE
        WHEN pace < 4.5 THEN 'Sub 4:30'
        WHEN pace < 5.0 THEN '4:30-5:00'
        WHEN pace < 5.5 THEN '5:00-5:30'
        WHEN pace < 6.0 THEN '5:30-6:00'
        WHEN pace < 6.5 THEN '6:00-6:30'
        WHEN pace < 7.0 THEN '6:30-7:00'
        WHEN pace < 7.5 THEN '7:00-7:30'
        WHEN pace < 8.0 THEN '7:30-8:00'
        ELSE '8:00+'
      END as zone,
      COUNT(*) as count,
      CASE
        WHEN pace < 4.5 THEN 1
        WHEN pace < 5.0 THEN 2
        WHEN pace < 5.5 THEN 3
        WHEN pace < 6.0 THEN 4
        WHEN pace < 6.5 THEN 5
        WHEN pace < 7.0 THEN 6
        WHEN pace < 7.5 THEN 7
        WHEN pace < 8.0 THEN 8
        ELSE 9
      END as sort_order
    FROM paces
    GROUP BY zone, sort_order
    ORDER BY sort_order ASC
  `;
  return rows;
}

async function getDistanceDistribution(rangeDays: number) {
  const sql = getDb();
  const rows = await sql`
    WITH distances AS (
      SELECT
        (raw_json->>'distance')::float / 1000.0 as km
      FROM garmin_activity_raw
      WHERE endpoint_name = 'summary'
        AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
        AND (raw_json->>'startTimeLocal')::timestamp >= CURRENT_DATE - make_interval(days => ${rangeDays})
    )
    SELECT
      CASE
        WHEN km < 3 THEN 'Under 3k'
        WHEN km < 5 THEN '3-5k'
        WHEN km < 8 THEN '5-8k'
        WHEN km < 10 THEN '8-10k'
        WHEN km < 15 THEN '10-15k'
        ELSE '15k+'
      END as bucket,
      COUNT(*) as count,
      CASE
        WHEN km < 3 THEN 1
        WHEN km < 5 THEN 2
        WHEN km < 8 THEN 3
        WHEN km < 10 THEN 4
        WHEN km < 15 THEN 5
        ELSE 6
      END as sort_order
    FROM distances
    GROUP BY bucket, sort_order
    ORDER BY sort_order ASC
  `;
  return rows;
}

async function getOverallHRDistribution(rangeDays: number) {
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
      AND (raw_json->>'startTimeLocal')::timestamp >= CURRENT_DATE - make_interval(days => ${rangeDays})
    GROUP BY zone, sort_order
    ORDER BY sort_order ASC
  `;
  return rows;
}

async function getMonthlyElevation(rangeDays: number) {
  const sql = getDb();
  const rows = await sql`
    SELECT
      TO_CHAR((raw_json->>'startTimeLocal')::timestamp, 'YYYY-MM') as month,
      SUM((raw_json->>'elevationGain')::float) as total_gain,
      AVG((raw_json->>'elevationGain')::float) as avg_gain,
      COUNT(*) as runs
    FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
      AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
      AND raw_json->>'elevationGain' IS NOT NULL
      AND (raw_json->>'elevationGain')::float > 0
      AND (raw_json->>'startTimeLocal')::timestamp >= CURRENT_DATE - make_interval(days => ${rangeDays})
    GROUP BY month
    ORDER BY month ASC
  `;
  return rows;
}

async function getRunningConsistency(rangeDays: number) {
  const sql = getDb();
  const rows = await sql`
    WITH weeks AS (
      SELECT
        DATE_TRUNC('week', (raw_json->>'startTimeLocal')::timestamp)::date as week,
        COUNT(*) as runs
      FROM garmin_activity_raw
      WHERE endpoint_name = 'summary'
        AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
        AND (raw_json->>'startTimeLocal')::timestamp >= CURRENT_DATE - make_interval(days => ${rangeDays})
      GROUP BY week
      ORDER BY week ASC
    )
    SELECT
      COUNT(*) as weeks_with_runs,
      AVG(runs) as avg_runs_per_week,
      MAX(runs) as max_runs_week,
      MIN(runs) as min_runs_week
    FROM weeks
  `;
  // Also get longest gap between runs
  const gaps = await sql`
    SELECT
      (raw_json->>'startTimeLocal')::date as run_date
    FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
      AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
      AND (raw_json->>'startTimeLocal')::timestamp >= CURRENT_DATE - make_interval(days => ${rangeDays})
    ORDER BY run_date ASC
  `;
  let maxGap = 0;
  for (let i = 1; i < gaps.length; i++) {
    const gap = (new Date(gaps[i].run_date).getTime() - new Date(gaps[i - 1].run_date).getTime()) / (24 * 60 * 60 * 1000);
    if (gap > maxGap) maxGap = gap;
  }
  const r = rows[0] || {};
  const totalWeeks = Math.round(rangeDays / 7);
  return {
    weeks_with_runs: Number(r.weeks_with_runs || 0),
    avg_runs_per_week: Number(r.avg_runs_per_week || 0),
    max_runs_week: Number(r.max_runs_week || 0),
    min_runs_week: Number(r.min_runs_week || 0),
    longest_gap_days: Math.round(maxGap),
    total_weeks: totalWeeks,
  };
}

async function getRecentRuns(rangeDays: number) {
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
    LEFT JOIN garmin_activity_raw w ON w.activity_id = s.activity_id AND w.endpoint_name = 'weather'
    WHERE s.endpoint_name = 'summary'
      AND s.raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
      AND (s.raw_json->>'startTimeLocal')::timestamp >= CURRENT_DATE - make_interval(days => ${rangeDays})
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

async function getSplitAnalysis(rangeDays: number) {
  const sql = getDb();
  const rows = await sql`
    WITH recent_activities AS (
      SELECT activity_id
      FROM garmin_activity_raw
      WHERE endpoint_name = 'summary'
        AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
        AND (raw_json->>'startTimeLocal')::timestamp >= CURRENT_DATE - make_interval(days => ${rangeDays})
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

async function getBestSplits(rangeDays: number) {
  const sql = getDb();
  const rows = await sql`
    WITH recent_activities AS (
      SELECT activity_id
      FROM garmin_activity_raw
      WHERE endpoint_name = 'summary'
        AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
        AND (raw_json->>'startTimeLocal')::timestamp >= CURRENT_DATE - make_interval(days => ${rangeDays})
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

  const [stats, paceHistory, mileage, vo2max, hrZones, hrPaceData, weeklyDist, cadenceStride, trainingEffects, records, recentRuns, fitnessScores, trainingStatus, paceDistribution, distanceDistribution, yearlyStats, monthlyElevation, runConsistency, hrDistribution, shoeMileage, splitAnalysis, bestSplits, trainingLoadTrend] =
    await Promise.all([
      getRunningStats(rangeDays),
      getPaceHistory(rangeDays),
      getMonthlyMileage(rangeDays),
      getVO2MaxTrend(rangeDays),
      getLatestHRZones(),
      getHRPaceData(rangeDays),
      getWeeklyDistance(rangeDays),
      getCadenceStride(rangeDays),
      getTrainingEffects(rangeDays),
      getPersonalRecords(),
      getRecentRuns(rangeDays),
      getFitnessScores(),
      getTrainingStatus(),
      getPaceDistribution(rangeDays),
      getDistanceDistribution(rangeDays),
      getYearlyRunningStats(),
      getMonthlyElevation(rangeDays),
      getRunningConsistency(rangeDays),
      getOverallHRDistribution(rangeDays),
      getShoeMileage(),
      getSplitAnalysis(rangeDays),
      getBestSplits(rangeDays),
      getTrainingLoadTrend(rangeDays),
    ]);

  return (
    <div className="container mx-auto px-6 py-8 max-w-7xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Running</h1>
          <p className="text-muted-foreground mt-1">
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
          value={stats?.peak_vo2max ? `${Number(stats.peak_vo2max)}` : "—"}
          subtitle="ml/kg/min"
          icon={<Zap className="h-4 w-4 text-yellow-400" />}
        />
      </div>

      {/* Charts Row 1: Pace + Monthly Mileage */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Pace Progression
            </CardTitle>
          </CardHeader>
          <CardContent>
            <PaceChart data={paceHistory as any} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Monthly Mileage
            </CardTitle>
          </CardHeader>
          <CardContent>
            <MileageChart data={mileage as any} />
          </CardContent>
        </Card>
      </div>

      {/* Year-over-Year Monthly Mileage */}
      {(mileage as any[]).length > 12 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-cyan-400" />
              Year-over-Year Mileage
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const yearMap = new Map<string, Map<number, number>>();
              for (const m of mileage as any[]) {
                const [year, month] = m.month.split("-");
                if (!yearMap.has(year)) yearMap.set(year, new Map());
                yearMap.get(year)!.set(parseInt(month), Number(Number(m.km).toFixed(1)));
              }
              const years = Array.from(yearMap.keys()).sort();
              const chartData = Array.from({ length: 12 }, (_, i) => {
                const entry: Record<string, number> = { month: i + 1 };
                for (const year of years) {
                  entry[year] = yearMap.get(year)?.get(i + 1) || 0;
                }
                return entry;
              });
              return <YearlyMileageChart data={chartData as any} years={years} />;
            })()}
          </CardContent>
        </Card>
      )}

      {/* Weekly Distance — last 52 weeks */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            Weekly Distance (Last Year)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <WeeklyDistanceChart
            data={(weeklyDist as any[])
              .slice(-52)
              .map((w: any) => ({
                week: w.week,
                km: Number(Number(w.km).toFixed(1)),
                runs: Number(w.runs),
              }))}
          />
        </CardContent>
      </Card>

      {/* Charts Row 2: VO2max + HR Zones */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              VO2max Trend
            </CardTitle>
          </CardHeader>
          <CardContent>
            <VO2MaxChart data={vo2max as any} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              HR Zones (Latest Run)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <HRZoneChart zones={hrZones as any} />
          </CardContent>
        </Card>
      </div>

      {/* HR vs Pace Scatter */}
      <Card className="mb-6">
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

      {/* Pace & Distance Distribution */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {/* Pace Distribution */}
        {(paceDistribution as any[]).length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Timer className="h-4 w-4 text-green-400" />
                Pace Distribution
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {(() => {
                  const zones = paceDistribution as any[];
                  const maxCount = Math.max(...zones.map((z: any) => Number(z.count)));
                  const total = zones.reduce((s: number, z: any) => s + Number(z.count), 0);
                  const colors = [
                    "bg-red-500", "bg-orange-500", "bg-amber-500", "bg-yellow-500",
                    "bg-lime-500", "bg-green-500", "bg-emerald-500", "bg-teal-500", "bg-cyan-500",
                  ];
                  return zones.map((z: any, i: number) => {
                    const count = Number(z.count);
                    const pct = (count / maxCount) * 100;
                    const sharePct = ((count / total) * 100).toFixed(0);
                    return (
                      <div key={z.zone} className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground w-20 text-right font-mono">{z.zone}</span>
                        <div className="flex-1 h-5 bg-muted rounded-sm overflow-hidden">
                          <div
                            className={`h-full ${colors[i] || "bg-primary"} rounded-sm`}
                            style={{ width: `${Math.max(pct, 3)}%` }}
                          />
                        </div>
                        <span className="text-xs w-8 text-right font-medium">{count}</span>
                        <span className="text-xs w-10 text-right text-muted-foreground">{sharePct}%</span>
                      </div>
                    );
                  });
                })()}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Distance Distribution */}
        {(distanceDistribution as any[]).length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <MapPin className="h-4 w-4 text-blue-400" />
                Distance Distribution
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {(() => {
                  const buckets = distanceDistribution as any[];
                  const maxCount = Math.max(...buckets.map((b: any) => Number(b.count)));
                  const total = buckets.reduce((s: number, b: any) => s + Number(b.count), 0);
                  const colors = [
                    "bg-blue-300", "bg-blue-400", "bg-blue-500", "bg-blue-600", "bg-indigo-500", "bg-violet-500",
                  ];
                  return buckets.map((b: any, i: number) => {
                    const count = Number(b.count);
                    const pct = (count / maxCount) * 100;
                    const sharePct = ((count / total) * 100).toFixed(0);
                    return (
                      <div key={b.bucket} className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground w-20 text-right font-mono">{b.bucket}</span>
                        <div className="flex-1 h-5 bg-muted rounded-sm overflow-hidden">
                          <div
                            className={`h-full ${colors[i] || "bg-primary"} rounded-sm`}
                            style={{ width: `${Math.max(pct, 3)}%` }}
                          />
                        </div>
                        <span className="text-xs w-8 text-right font-medium">{count}</span>
                        <span className="text-xs w-10 text-right text-muted-foreground">{sharePct}%</span>
                      </div>
                    );
                  });
                })()}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Overall HR Zone Distribution */}
      {(hrDistribution as any[]).length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <HeartPulse className="h-4 w-4 text-red-400" />
              Training Intensity Distribution (All Runs)
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
                  {/* Stacked bar showing proportion */}
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
                  {/* Zone details */}
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

      {/* Cadence & Stride + Training Effect */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Cadence & Stride Length
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CadenceStrideChart
              data={(cadenceStride as any[]).map((c: any) => ({
                date: c.date,
                cadence: Number(c.cadence),
                stride: Number(c.stride),
              }))}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Training Effect Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const te = (trainingEffects as any[]).filter((t: any) => Number(t.aerobic_te) > 0);
              if (te.length === 0) return <div className="flex items-center justify-center h-[250px] text-muted-foreground text-sm">No data</div>;

              // Categorize training effects
              const categories = [
                { label: "Minor", range: "0-1.9", color: "bg-slate-400", min: 0, max: 2 },
                { label: "Maintaining", range: "2.0-2.9", color: "bg-blue-400", min: 2, max: 3 },
                { label: "Improving", range: "3.0-3.9", color: "bg-green-400", min: 3, max: 4 },
                { label: "Highly Improving", range: "4.0-4.9", color: "bg-orange-400", min: 4, max: 5 },
                { label: "Overreaching", range: "5.0", color: "bg-red-400", min: 5, max: 6 },
              ];

              const counts = categories.map((cat) => ({
                ...cat,
                count: te.filter((t: any) => {
                  const v = Number(t.aerobic_te);
                  return v >= cat.min && v < cat.max;
                }).length,
              }));

              const maxCount = Math.max(...counts.map((c) => c.count));
              const avgTE = te.reduce((s: number, t: any) => s + Number(t.aerobic_te), 0) / te.length;

              return (
                <div className="space-y-3">
                  <div className="text-center mb-4">
                    <div className="text-2xl font-bold">{avgTE.toFixed(1)}</div>
                    <div className="text-xs text-muted-foreground">Avg Aerobic TE</div>
                  </div>
                  {counts.filter((c) => c.count > 0).map((cat) => (
                    <div key={cat.label} className="flex items-center gap-3">
                      <div className="w-28 text-xs text-muted-foreground">{cat.label}</div>
                      <div className="flex-1 h-5 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full ${cat.color} rounded-full transition-all`}
                          style={{ width: `${(cat.count / maxCount) * 100}%` }}
                        />
                      </div>
                      <div className="w-8 text-xs text-right text-muted-foreground">{cat.count}</div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </CardContent>
        </Card>
      </div>

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

      {/* Training Status */}
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

      {/* Running Consistency (Last 26 Weeks) */}
      {runConsistency?.weeks_with_runs && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Activity className="h-4 w-4 text-emerald-400" />
              Running Consistency (Last 6 Months)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div>
                <div className="text-xs text-muted-foreground mb-1">Active Weeks</div>
                <div className="text-2xl font-bold">
                  {Number(runConsistency.weeks_with_runs)}/{runConsistency.total_weeks}
                </div>
                <div className="text-xs text-muted-foreground">
                  {Math.round((Number(runConsistency.weeks_with_runs) / runConsistency.total_weeks) * 100)}% consistency
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Avg Runs/Week</div>
                <div className="text-2xl font-bold">
                  {Number(runConsistency.avg_runs_per_week).toFixed(1)}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Best Week</div>
                <div className="text-2xl font-bold text-green-400">
                  {Number(runConsistency.max_runs_week)} {Number(runConsistency.max_runs_week) === 1 ? "run" : "runs"}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Min Week</div>
                <div className="text-2xl font-bold">
                  {Number(runConsistency.min_runs_week)} {Number(runConsistency.min_runs_week) === 1 ? "run" : "runs"}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Longest Gap</div>
                <div className="text-2xl font-bold text-yellow-400">
                  {runConsistency.longest_gap_days}d
                </div>
              </div>
            </div>
            {/* Consistency bar */}
            <div className="mt-4 h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-green-400 rounded-full"
                style={{ width: `${Math.round((Number(runConsistency.weeks_with_runs) / runConsistency.total_weeks) * 100)}%` }}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Monthly Elevation Gain */}
      {(monthlyElevation as any[]).length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Mountain className="h-4 w-4 text-amber-400" />
              Monthly Elevation Gain
              <span className="ml-auto text-xs font-normal">
                {(() => {
                  const data = monthlyElevation as any[];
                  const total = data.reduce((s: number, m: any) => s + Number(m.total_gain || 0), 0);
                  return `${Math.round(total).toLocaleString()}m total`;
                })()}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-[3px] h-28">
              {(monthlyElevation as any[]).slice(-24).map((m: any, i: number) => {
                const gain = Number(m.total_gain || 0);
                const maxGain = Math.max(...(monthlyElevation as any[]).slice(-24).map((x: any) => Number(x.total_gain || 0)));
                const pct = maxGain > 0 ? (gain / maxGain) * 100 : 0;
                const monthDate = new Date(m.month + "-01");
                const label = monthDate.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
                return (
                  <div key={i} className="flex-1 flex flex-col items-center">
                    {pct > 40 && (
                      <span className="text-[8px] text-muted-foreground mb-0.5">
                        {Math.round(gain)}m
                      </span>
                    )}
                    <div className="w-full flex items-end justify-center" style={{ height: "80px" }}>
                      <div
                        className="w-full rounded-t-sm bg-amber-400/70"
                        style={{ height: `${Math.max(pct, gain > 0 ? 4 : 0)}%` }}
                        title={`${label}: ${Math.round(gain)}m gain (${m.runs} runs)`}
                      />
                    </div>
                    {i % 3 === 0 && (
                      <span className="text-[9px] text-muted-foreground mt-0.5">
                        {label}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Yearly Summary */}
      {(yearlyStats as any[]).length > 1 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-blue-400" />
              Year-over-Year Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="text-left py-2 text-xs font-medium text-muted-foreground">Year</th>
                    <th className="text-right py-2 text-xs font-medium text-muted-foreground">Runs</th>
                    <th className="text-right py-2 text-xs font-medium text-muted-foreground">Distance</th>
                    <th className="text-right py-2 text-xs font-medium text-muted-foreground">Avg Pace</th>
                    <th className="text-right py-2 text-xs font-medium text-muted-foreground">Avg HR</th>
                    <th className="text-right py-2 text-xs font-medium text-muted-foreground">Longest</th>
                    <th className="text-right py-2 text-xs font-medium text-muted-foreground">Calories</th>
                  </tr>
                </thead>
                <tbody>
                  {(yearlyStats as any[]).map((y: any, i: number) => {
                    const prevYear = (yearlyStats as any[])[i + 1];
                    const kmDiff = prevYear ? Number(y.total_km) - Number(prevYear.total_km) : null;
                    return (
                      <tr key={y.year} className="border-b border-border/20 hover:bg-muted/30">
                        <td className="py-2 font-medium">{y.year}</td>
                        <td className="py-2 text-right">{Number(y.runs)}</td>
                        <td className="py-2 text-right">
                          {Number(y.total_km).toFixed(0)} km
                          {kmDiff !== null && (
                            <span className={`ml-1 text-xs ${kmDiff >= 0 ? "text-green-400" : "text-red-400"}`}>
                              {kmDiff >= 0 ? "+" : ""}{kmDiff.toFixed(0)}
                            </span>
                          )}
                        </td>
                        <td className="py-2 text-right font-mono">{y.avg_pace ? formatPace(Number(y.avg_pace)) : "—"}</td>
                        <td className="py-2 text-right">{y.avg_hr ? Math.round(Number(y.avg_hr)) : "—"}</td>
                        <td className="py-2 text-right">{Number(y.longest_km).toFixed(1)} km</td>
                        <td className="py-2 text-right text-muted-foreground">{y.total_cal ? Math.round(Number(y.total_cal)).toLocaleString() : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
