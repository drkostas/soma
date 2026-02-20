import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/stat-card";
import { WeightChart } from "@/components/weight-chart";
import { getDb } from "@/lib/db";

export const revalidate = 300; // Revalidate every 5 minutes

async function getTodayHealth() {
  const sql = getDb();
  const rows = await sql`
    SELECT * FROM daily_health_summary
    ORDER BY date DESC
    LIMIT 1
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

export default async function Home() {
  const [health, weightHistory, latestWeight] = await Promise.all([
    getTodayHealth(),
    getWeightHistory(),
    getLatestWeight(),
  ]);

  return (
    <main className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Soma</h1>
          <p className="text-muted-foreground mt-1">
            {health?.date
              ? `Last synced: ${new Date(health.date).toLocaleDateString()}`
              : "No data synced yet. Run the pipeline to get started."}
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard
            title="Steps"
            value={health?.total_steps?.toLocaleString() ?? "\u2014"}
            subtitle={health?.total_distance_meters
              ? `${(health.total_distance_meters / 1000).toFixed(1)} km`
              : undefined}
          />
          <StatCard
            title="Calories"
            value={health?.total_kilocalories?.toLocaleString() ?? "\u2014"}
            subtitle={health?.active_kilocalories
              ? `${health.active_kilocalories} active`
              : undefined}
          />
          <StatCard
            title="Resting HR"
            value={health?.resting_heart_rate ? `${health.resting_heart_rate} bpm` : "\u2014"}
            subtitle={health?.hrv_last_night_avg
              ? `HRV ${health.hrv_last_night_avg}ms`
              : undefined}
          />
          <StatCard
            title="Weight"
            value={latestWeight ? `${latestWeight.weight_kg.toFixed(1)} kg` : "\u2014"}
            subtitle={latestWeight?.date
              ? new Date(latestWeight.date).toLocaleDateString()
              : undefined}
          />
        </div>

        {/* Secondary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard
            title="Sleep"
            value={health?.sleep_time_seconds
              ? `${(health.sleep_time_seconds / 3600).toFixed(1)}h`
              : "\u2014"}
          />
          <StatCard
            title="Stress"
            value={health?.avg_stress_level ?? "\u2014"}
            subtitle={health?.max_stress_level
              ? `Max: ${health.max_stress_level}`
              : undefined}
          />
          <StatCard
            title="Body Battery"
            value={health?.body_battery_charged
              ? `+${health.body_battery_charged}`
              : "\u2014"}
            subtitle={health?.body_battery_drained
              ? `Drained: ${health.body_battery_drained}`
              : undefined}
          />
          <StatCard
            title="HRV Status"
            value={health?.hrv_status ?? "\u2014"}
            subtitle={health?.hrv_weekly_avg
              ? `Weekly avg: ${health.hrv_weekly_avg}ms`
              : undefined}
          />
        </div>

        {/* Weight Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Weight Trend (30 days)</CardTitle>
          </CardHeader>
          <CardContent>
            <WeightChart data={weightHistory as any} />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
