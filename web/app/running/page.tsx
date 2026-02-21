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
import { YearlyMileageChart } from "@/components/yearly-mileage-chart";
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
} from "lucide-react";

export const revalidate = 300;

function formatPace(mins: number) {
  const m = Math.floor(mins);
  const s = Math.round((mins - m) * 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

async function getRunningStats() {
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
  `;
  return rows[0] || null;
}

async function getPaceHistory() {
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
    ORDER BY (raw_json->>'startTimeLocal')::text ASC
  `;
  return rows;
}

async function getMonthlyMileage() {
  const sql = getDb();
  const rows = await sql`
    SELECT
      TO_CHAR((raw_json->>'startTimeLocal')::timestamp, 'YYYY-MM') as month,
      COUNT(*) as runs,
      SUM((raw_json->>'distance')::float) / 1000.0 as km
    FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
      AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
    GROUP BY month ORDER BY month ASC
  `;
  return rows;
}

async function getVO2MaxTrend() {
  const sql = getDb();
  const rows = await sql`
    SELECT DISTINCT ON (LEFT((raw_json->>'startTimeLocal')::text, 10))
      LEFT((raw_json->>'startTimeLocal')::text, 10) as date,
      (raw_json->>'vO2MaxValue')::float as vo2max
    FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
      AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
      AND raw_json->>'vO2MaxValue' IS NOT NULL
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

async function getHRPaceData() {
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
      AND raw_json->>'averageHR' IS NOT NULL
    ORDER BY (raw_json->>'startTimeLocal')::text ASC
  `;
  return rows;
}

async function getWeeklyDistance() {
  const sql = getDb();
  const rows = await sql`
    SELECT
      TO_CHAR(DATE_TRUNC('week', (raw_json->>'startTimeLocal')::timestamp), 'YYYY-MM-DD') as week,
      COUNT(*) as runs,
      SUM((raw_json->>'distance')::float) / 1000.0 as km
    FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
      AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
    GROUP BY week ORDER BY week ASC
  `;
  return rows;
}

async function getCadenceStride() {
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
      AND (raw_json->>'distance')::float > 1000
    ORDER BY (raw_json->>'startTimeLocal')::text ASC
  `;
  return rows;
}

async function getTrainingEffects() {
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

async function getPersonalRecords() {
  const sql = getDb();

  // Fastest 5K (runs >= 5km, best pace)
  const fastest5k = await sql`
    SELECT
      (raw_json->>'startTimeLocal')::text as date,
      (raw_json->>'activityName')::text as name,
      (raw_json->>'duration')::float / NULLIF((raw_json->>'distance')::float / 1000.0, 0) / 60.0 as pace,
      (raw_json->>'distance')::float / 1000.0 as distance
    FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
      AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
      AND (raw_json->>'distance')::float >= 4800
    ORDER BY (raw_json->>'duration')::float / NULLIF((raw_json->>'distance')::float, 0) ASC
    LIMIT 1
  `;

  // Longest run
  const longest = await sql`
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
  `;

  // Highest avg HR
  const maxHR = await sql`
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
  `;

  // Most calories
  const maxCal = await sql`
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
  `;

  return {
    fastest5k: fastest5k[0] || null,
    longest: longest[0] || null,
    maxHR: maxHR[0] || null,
    maxCal: maxCal[0] || null,
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

async function getPaceDistribution() {
  const sql = getDb();
  const rows = await sql`
    WITH paces AS (
      SELECT
        (raw_json->>'duration')::float / NULLIF((raw_json->>'distance')::float / 1000.0, 0) / 60.0 as pace
      FROM garmin_activity_raw
      WHERE endpoint_name = 'summary'
        AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
        AND (raw_json->>'distance')::float > 1000
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

async function getDistanceDistribution() {
  const sql = getDb();
  const rows = await sql`
    WITH distances AS (
      SELECT
        (raw_json->>'distance')::float / 1000.0 as km
      FROM garmin_activity_raw
      WHERE endpoint_name = 'summary'
        AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
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

async function getRecentRuns() {
  const sql = getDb();
  const rows = await sql`
    SELECT
      activity_id::text as activity_id,
      (raw_json->>'startTimeLocal')::text as date,
      (raw_json->>'activityName')::text as name,
      (raw_json->>'distance')::float / 1000.0 as distance,
      (raw_json->>'duration')::float / 60.0 as duration_min,
      (raw_json->>'duration')::float / NULLIF((raw_json->>'distance')::float / 1000.0, 0) / 60.0 as pace,
      (raw_json->>'averageHR')::float as avg_hr,
      (raw_json->>'calories')::float as calories,
      (raw_json->>'elevationGain')::float as elev_gain
    FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
      AND raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running')
    ORDER BY (raw_json->>'startTimeLocal')::text DESC
    LIMIT 10
  `;
  return rows;
}

export default async function RunningPage() {
  const [stats, paceHistory, mileage, vo2max, hrZones, hrPaceData, weeklyDist, cadenceStride, trainingEffects, records, recentRuns, fitnessScores, trainingStatus, paceDistribution, distanceDistribution, yearlyStats] =
    await Promise.all([
      getRunningStats(),
      getPaceHistory(),
      getMonthlyMileage(),
      getVO2MaxTrend(),
      getLatestHRZones(),
      getHRPaceData(),
      getWeeklyDistance(),
      getCadenceStride(),
      getTrainingEffects(),
      getPersonalRecords(),
      getRecentRuns(),
      getFitnessScores(),
      getTrainingStatus(),
      getPaceDistribution(),
      getDistanceDistribution(),
      getYearlyRunningStats(),
    ]);

  return (
    <div className="container mx-auto px-6 py-8 max-w-7xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Running</h1>
        <p className="text-muted-foreground mt-1">
          {stats?.total_runs
            ? `${Number(stats.total_runs)} runs tracked · ${Number(stats.total_km).toFixed(0)} km total`
            : "No runs tracked yet."}
        </p>
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
              return <YearlyMileageChart data={chartData} years={years} />;
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {records.fastest5k && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">Best Pace (5K+)</div>
                <div className="text-lg font-bold">
                  {formatPace(Number(records.fastest5k.pace))}/km
                </div>
                <div className="text-xs text-muted-foreground">
                  {Number(records.fastest5k.distance).toFixed(1)} km ·{" "}
                  {new Date(records.fastest5k.date).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </div>
              </div>
            )}
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
                  })}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

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
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
