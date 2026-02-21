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
      AND raw_json->'activityType'->>'typeKey' = 'running'
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
      AND raw_json->'activityType'->>'typeKey' = 'running'
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
      AND raw_json->'activityType'->>'typeKey' = 'running'
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
      AND raw_json->'activityType'->>'typeKey' = 'running'
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
      AND raw_json->'activityType'->>'typeKey' = 'running'
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
      AND raw_json->'activityType'->>'typeKey' = 'running'
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
      AND raw_json->'activityType'->>'typeKey' = 'running'
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
      AND raw_json->'activityType'->>'typeKey' = 'running'
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
      AND raw_json->'activityType'->>'typeKey' = 'running'
      AND raw_json->>'aerobicTrainingEffect' IS NOT NULL
    ORDER BY (raw_json->>'startTimeLocal')::text ASC
  `;
  return rows;
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
      AND raw_json->'activityType'->>'typeKey' = 'running'
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
      AND raw_json->'activityType'->>'typeKey' = 'running'
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
      AND raw_json->'activityType'->>'typeKey' = 'running'
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
      AND raw_json->'activityType'->>'typeKey' = 'running'
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
      AND raw_json->'activityType'->>'typeKey' = 'running'
    ORDER BY (raw_json->>'startTimeLocal')::text DESC
    LIMIT 10
  `;
  return rows;
}

export default async function RunningPage() {
  const [stats, paceHistory, mileage, vo2max, hrZones, hrPaceData, weeklyDist, cadenceStride, trainingEffects, records, recentRuns] =
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

      {/* Weekly Distance */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            Weekly Distance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <WeeklyDistanceChart
            data={(weeklyDist as any[]).map((w: any) => ({
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
