import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/stat-card";
import { PaceChart } from "@/components/pace-chart";
import { MileageChart } from "@/components/mileage-chart";
import { HRZoneChart } from "@/components/hr-zone-chart";
import { VO2MaxChart } from "@/components/vo2max-chart";
import { getDb } from "@/lib/db";
import {
  Timer,
  MapPin,
  HeartPulse,
  Zap,
  Trophy,
  TrendingUp,
  Footprints,
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
  const [stats, paceHistory, mileage, vo2max, hrZones, records, recentRuns] =
    await Promise.all([
      getRunningStats(),
      getPaceHistory(),
      getMonthlyMileage(),
      getVO2MaxTrend(),
      getLatestHRZones(),
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
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-2 font-medium">Date</th>
                  <th className="text-left py-2 font-medium">Name</th>
                  <th className="text-right py-2 font-medium">Distance</th>
                  <th className="text-right py-2 font-medium">Duration</th>
                  <th className="text-right py-2 font-medium">Pace</th>
                  <th className="text-right py-2 font-medium">HR</th>
                  <th className="text-right py-2 font-medium">Cal</th>
                </tr>
              </thead>
              <tbody>
                {recentRuns.map((run: any, i: number) => (
                  <tr key={i} className="border-b border-border/50">
                    <td className="py-2 text-muted-foreground">
                      {new Date(run.date).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </td>
                    <td className="py-2">{run.name}</td>
                    <td className="py-2 text-right">
                      {Number(run.distance).toFixed(1)} km
                    </td>
                    <td className="py-2 text-right">
                      {Math.round(Number(run.duration_min))} min
                    </td>
                    <td className="py-2 text-right font-medium">
                      {run.pace ? formatPace(Number(run.pace)) : "—"}
                    </td>
                    <td className="py-2 text-right">
                      {run.avg_hr ? Math.round(Number(run.avg_hr)) : "—"}
                    </td>
                    <td className="py-2 text-right text-muted-foreground">
                      {run.calories ? Math.round(Number(run.calories)) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
