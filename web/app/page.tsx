import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/stat-card";
import { WeightChart } from "@/components/weight-chart";
import { getDb } from "@/lib/db";
import {
  Footprints,
  Flame,
  HeartPulse,
  Scale,
  Moon,
  Brain,
  BatteryCharging,
  Activity,
  Dumbbell,
  Database,
  TrendingDown,
  TrendingUp,
  Minus,
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
      ROUND(AVG(body_battery_charged)) as avg_bb_charged,
      COUNT(*) as days_count
    FROM daily_health_summary
    WHERE date >= CURRENT_DATE - 7
  `;
  return rows[0] || null;
}

async function getWeightHistory() {
  const sql = getDb();
  const rows = await sql`
    SELECT date, weight_grams / 1000.0 as weight_kg
    FROM weight_log
    WHERE date >= CURRENT_DATE - 30
    ORDER BY date ASC
  `;
  return rows;
}

async function getLatestWeight() {
  const sql = getDb();
  const rows = await sql`
    SELECT weight_grams / 1000.0 as weight_kg, date
    FROM weight_log
    ORDER BY date DESC
    LIMIT 1
  `;
  return rows[0] || null;
}

async function getWeightDelta() {
  const sql = getDb();
  const rows = await sql`
    WITH latest AS (
      SELECT weight_grams / 1000.0 as kg FROM weight_log ORDER BY date DESC LIMIT 1
    ),
    week_ago AS (
      SELECT weight_grams / 1000.0 as kg FROM weight_log WHERE date <= CURRENT_DATE - 7 ORDER BY date DESC LIMIT 1
    )
    SELECT latest.kg - week_ago.kg as delta_7d
    FROM latest, week_ago
  `;
  return rows[0]?.delta_7d ?? null;
}

async function getWorkoutStats() {
  const sql = getDb();
  const rows = await sql`
    SELECT
      COUNT(*) as total_workouts,
      MIN(raw_json->>'start_time') as first_workout,
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

async function getDataCoverage() {
  const sql = getDb();
  const garmin = await sql`SELECT COUNT(*) as count FROM garmin_raw_data`;
  const hevy = await sql`SELECT COUNT(*) as count FROM hevy_raw_data`;
  const activities = await sql`SELECT COUNT(DISTINCT activity_id) as count FROM garmin_activity_raw`;
  const profile = await sql`SELECT COUNT(*) as count FROM garmin_profile_raw`;
  return {
    garmin_records: garmin[0]?.count ?? 0,
    hevy_records: hevy[0]?.count ?? 0,
    activities: activities[0]?.count ?? 0,
    profile: profile[0]?.count ?? 0,
  };
}

function TrendIcon({ value }: { value: number | null }) {
  if (value === null) return null;
  if (value > 0.1) return <TrendingUp className="h-3 w-3 text-red-400" />;
  if (value < -0.1) return <TrendingDown className="h-3 w-3 text-green-400" />;
  return <Minus className="h-3 w-3 text-muted-foreground" />;
}

export default async function Home() {
  const [health, weekly, weightHistory, latestWeight, weightDelta, workouts, coverage] =
    await Promise.all([
      getTodayHealth(),
      getWeeklyAverages(),
      getWeightHistory(),
      getLatestWeight(),
      getWeightDelta(),
      getWorkoutStats(),
      getDataCoverage(),
    ]);

  const totalRecords =
    Number(coverage.garmin_records) +
    Number(coverage.hevy_records) +
    Number(coverage.activities) +
    Number(coverage.profile);

  return (
    <div className="container mx-auto px-6 py-8 max-w-7xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Overview</h1>
        <p className="text-muted-foreground mt-1">
          {health?.date
            ? `Latest data: ${new Date(health.date).toLocaleDateString("en-US", {
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
          title="Weight"
          value={latestWeight ? `${Number(latestWeight.weight_kg).toFixed(1)} kg` : "—"}
          subtitle={
            weightDelta !== null
              ? `${weightDelta > 0 ? "+" : ""}${Number(weightDelta).toFixed(1)} kg this week`
              : undefined
          }
          icon={<Scale className="h-4 w-4 text-blue-400" />}
          trend={weightDelta}
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
          title="HRV"
          value={health?.hrv_last_night_avg ? `${health.hrv_last_night_avg} ms` : "—"}
          subtitle={health?.hrv_status ?? undefined}
          icon={<Activity className="h-4 w-4 text-purple-400" />}
        />
      </div>

      {/* 7-Day Averages + Workout Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              7-Day Averages
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {weekly ? (
              <>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Steps</span>
                  <span className="font-medium">{Number(weekly.avg_steps).toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Sleep</span>
                  <span className="font-medium">
                    {weekly.avg_sleep ? `${(Number(weekly.avg_sleep) / 3600).toFixed(1)}h` : "—"}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Resting HR</span>
                  <span className="font-medium">{weekly.avg_rhr ?? "—"} bpm</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Stress</span>
                  <span className="font-medium">{weekly.avg_stress ?? "—"}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Active Cal</span>
                  <span className="font-medium">{Number(weekly.avg_active_cal).toLocaleString()}</span>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Not enough data</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Strength Training
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 mb-2">
              <Dumbbell className="h-5 w-5 text-primary" />
              <span className="text-2xl font-bold">{Number(workouts.total)}</span>
              <span className="text-sm text-muted-foreground">total workouts</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">This week</span>
              <span className="font-medium">{Number(workouts.count_7d)}</span>
            </div>
            {workouts.last && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Last workout</span>
                <span className="font-medium">
                  {new Date(workouts.last).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Data Coverage
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 mb-2">
              <Database className="h-5 w-5 text-primary" />
              <span className="text-2xl font-bold">{totalRecords.toLocaleString()}</span>
              <span className="text-sm text-muted-foreground">records</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Garmin daily</span>
              <span className="font-medium">{Number(coverage.garmin_records).toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Hevy</span>
              <span className="font-medium">{Number(coverage.hevy_records).toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Activities</span>
              <span className="font-medium">{Number(coverage.activities)}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Weight Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Weight Trend (30 days)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <WeightChart data={weightHistory as any} />
        </CardContent>
      </Card>
    </div>
  );
}
