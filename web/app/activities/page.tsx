import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/stat-card";
import { MonthlyActivityChart } from "@/components/monthly-activity-chart";
import { KiteSpeedChart } from "@/components/kite-speed-chart";
import { PaginatedActivityTable } from "@/components/paginated-activity-table";
import { getDb } from "@/lib/db";
import {
  Wind,
  Snowflake,
  Mountain,
  Bike,
  Waves,
  MapPin,
  Clock,
  Flame,
  Gauge,
  ArrowUp,
  Trophy,
  PersonStanding,
  Heart,
  Activity,
} from "lucide-react";

export const revalidate = 300;

const ACTIVITY_ICONS: Record<string, React.ReactNode> = {
  kiteboarding_v2: <Wind className="h-4 w-4 text-cyan-400" />,
  wind_kite_surfing: <Wind className="h-4 w-4 text-cyan-400" />,
  resort_snowboarding: <Snowflake className="h-4 w-4 text-blue-300" />,
  resort_skiing_snowboarding_ws: <Snowflake className="h-4 w-4 text-blue-300" />,
  hiking: <Mountain className="h-4 w-4 text-green-400" />,
  e_bike_fitness: <Bike className="h-4 w-4 text-yellow-400" />,
  lap_swimming: <Waves className="h-4 w-4 text-blue-400" />,
  walking: <PersonStanding className="h-4 w-4 text-emerald-400" />,
  cycling: <Bike className="h-4 w-4 text-yellow-400" />,
  indoor_cardio: <Heart className="h-4 w-4 text-red-400" />,
  indoor_cycling: <Bike className="h-4 w-4 text-yellow-400" />,
  stand_up_paddleboarding_v2: <Waves className="h-4 w-4 text-cyan-300" />,
  other: <Activity className="h-4 w-4 text-muted-foreground" />,
};

const ACTIVITY_LABELS: Record<string, string> = {
  kiteboarding_v2: "Kiteboarding",
  wind_kite_surfing: "Kite Surfing",
  resort_snowboarding: "Snowboarding",
  resort_skiing_snowboarding_ws: "Snowboarding",
  hiking: "Hiking",
  e_bike_fitness: "E-Bike",
  lap_swimming: "Swimming",
  walking: "Walking",
  cycling: "Cycling",
  indoor_cardio: "Cardio",
  indoor_cycling: "Indoor Cycle",
  stand_up_paddleboarding_v2: "SUP",
  other: "Other",
};

const SPORT_GROUPS: Record<string, string[]> = {
  Kiteboarding: ["kiteboarding_v2", "wind_kite_surfing"],
  Snowboarding: ["resort_snowboarding", "resort_skiing_snowboarding_ws"],
  Hiking: ["hiking"],
  "E-Bike": ["e_bike_fitness"],
  Swimming: ["lap_swimming"],
  Walking: ["walking"],
  Cycling: ["cycling"],
  Cardio: ["indoor_cardio"],
  SUP: ["stand_up_paddleboarding_v2"],
  Other: ["other", "indoor_cycling"],
};

async function getActivitySummary() {
  const sql = getDb();
  const rows = await sql`
    SELECT
      raw_json->'activityType'->>'typeKey' as type_key,
      COUNT(*) as count,
      SUM((raw_json->>'distance')::float) / 1000.0 as total_km,
      SUM((raw_json->>'duration')::float) / 3600.0 as total_hours,
      SUM((raw_json->>'calories')::float) as total_cal,
      SUM(COALESCE((raw_json->>'elevationGain')::float, 0)) as total_elev
    FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
      AND raw_json->'activityType'->>'typeKey' NOT IN ('running', 'treadmill_running', 'strength_training')
    GROUP BY type_key
    ORDER BY count DESC
  `;
  return rows;
}

async function getKiteSessions() {
  const sql = getDb();
  const rows = await sql`
    SELECT
      raw_json->>'activityName' as name,
      (raw_json->>'startTimeLocal')::text as date,
      (raw_json->>'maxSpeed')::float * 1.94384 as max_speed_kts,
      (raw_json->>'averageSpeed')::float * 1.94384 as avg_speed_kts,
      (raw_json->>'distance')::float / 1000.0 as distance_km,
      (raw_json->>'duration')::float / 60.0 as duration_min,
      (raw_json->>'averageHR')::float as avg_hr,
      (raw_json->>'calories')::float as calories
    FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
      AND raw_json->'activityType'->>'typeKey' IN ('kiteboarding_v2', 'wind_kite_surfing')
    ORDER BY (raw_json->>'startTimeLocal')::text ASC
  `;
  return rows;
}

async function getSnowSessions() {
  const sql = getDb();
  const rows = await sql`
    SELECT
      raw_json->>'activityName' as name,
      (raw_json->>'startTimeLocal')::text as date,
      (raw_json->>'maxSpeed')::float * 3.6 as max_speed_kmh,
      (raw_json->>'distance')::float / 1000.0 as distance_km,
      (raw_json->>'duration')::float / 60.0 as duration_min,
      COALESCE((raw_json->>'elevationGain')::float, 0) as elev_gain,
      (raw_json->>'averageHR')::float as avg_hr
    FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
      AND raw_json->'activityType'->>'typeKey' IN ('resort_snowboarding', 'resort_skiing_snowboarding_ws')
    ORDER BY (raw_json->>'startTimeLocal')::text DESC
  `;
  return rows;
}

async function getMonthlyDistribution() {
  const sql = getDb();
  const rows = await sql`
    SELECT
      TO_CHAR(DATE_TRUNC('month', (raw_json->>'startTimeLocal')::timestamp), 'YYYY-MM') as month,
      raw_json->'activityType'->>'typeKey' as type_key,
      COUNT(*) as count
    FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
      AND raw_json->'activityType'->>'typeKey' NOT IN ('running', 'treadmill_running', 'strength_training')
    GROUP BY month, type_key
    ORDER BY month ASC
  `;
  return rows;
}

async function getYearlySportBreakdown() {
  const sql = getDb();
  const rows = await sql`
    SELECT
      EXTRACT(YEAR FROM (raw_json->>'startTimeLocal')::timestamp)::int as year,
      raw_json->'activityType'->>'typeKey' as type_key,
      COUNT(*) as count,
      SUM((raw_json->>'distance')::float) / 1000.0 as total_km,
      SUM((raw_json->>'duration')::float) / 3600.0 as total_hours
    FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
      AND raw_json->'activityType'->>'typeKey' NOT IN ('running', 'treadmill_running', 'strength_training')
    GROUP BY year, type_key
    ORDER BY year DESC, count DESC
  `;
  return rows;
}

async function getCyclingSessions() {
  const sql = getDb();
  const rows = await sql`
    SELECT
      (raw_json->>'startTimeLocal')::text as date,
      raw_json->>'activityName' as name,
      (raw_json->>'distance')::float / 1000.0 as distance_km,
      (raw_json->>'duration')::float / 60.0 as duration_min,
      (raw_json->>'averageSpeed')::float * 3.6 as avg_speed_kmh,
      (raw_json->>'maxSpeed')::float * 3.6 as max_speed_kmh,
      COALESCE((raw_json->>'elevationGain')::float, 0) as elev_gain,
      (raw_json->>'averageHR')::float as avg_hr,
      (raw_json->>'calories')::float as calories,
      raw_json->'activityType'->>'typeKey' as type_key
    FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
      AND raw_json->'activityType'->>'typeKey' IN ('cycling', 'e_bike_fitness', 'indoor_cycling')
    ORDER BY (raw_json->>'startTimeLocal')::text DESC
  `;
  return rows;
}

async function getTimeBreakdown() {
  const sql = getDb();
  const rows = await sql`
    SELECT
      CASE
        WHEN raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running') THEN 'Running'
        WHEN raw_json->'activityType'->>'typeKey' = 'strength_training' THEN 'Gym'
        WHEN raw_json->'activityType'->>'typeKey' = 'walking' THEN 'Walking'
        WHEN raw_json->'activityType'->>'typeKey' IN ('cycling', 'e_bike_fitness', 'indoor_cycling') THEN 'Cycling'
        WHEN raw_json->'activityType'->>'typeKey' IN ('kiteboarding_v2', 'wind_kite_surfing') THEN 'Kite'
        WHEN raw_json->'activityType'->>'typeKey' IN ('resort_snowboarding', 'resort_skiing_snowboarding_ws') THEN 'Snow'
        WHEN raw_json->'activityType'->>'typeKey' IN ('lap_swimming', 'swimming') THEN 'Swim'
        WHEN raw_json->'activityType'->>'typeKey' = 'indoor_cardio' THEN 'Cardio'
        ELSE 'Other'
      END as category,
      SUM((raw_json->>'duration')::float) / 3600.0 as hours,
      COUNT(*) as sessions
    FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
    GROUP BY category
    ORDER BY hours DESC
  `;
  return rows;
}

async function getWalkingSessions() {
  const sql = getDb();
  const rows = await sql`
    SELECT
      (raw_json->>'startTimeLocal')::text as date,
      raw_json->>'activityName' as name,
      (raw_json->>'distance')::float / 1000.0 as distance_km,
      (raw_json->>'duration')::float / 60.0 as duration_min,
      COALESCE((raw_json->>'elevationGain')::float, 0) as elev_gain,
      (raw_json->>'averageHR')::float as avg_hr,
      (raw_json->>'calories')::float as calories,
      (raw_json->>'averageSpeed')::float * 3.6 as avg_speed_kmh
    FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
      AND raw_json->'activityType'->>'typeKey' = 'walking'
    ORDER BY (raw_json->>'startTimeLocal')::text DESC
  `;
  return rows;
}

async function getAllActivities() {
  const sql = getDb();
  const rows = await sql`
    SELECT
      activity_id::text as activity_id,
      raw_json->'activityType'->>'typeKey' as type_key,
      (raw_json->>'startTimeLocal')::text as date,
      raw_json->>'activityName' as name,
      (raw_json->>'distance')::float / 1000.0 as distance_km,
      (raw_json->>'duration')::float / 60.0 as duration_min,
      (raw_json->>'averageHR')::float as avg_hr,
      (raw_json->>'calories')::float as calories,
      COALESCE((raw_json->>'elevationGain')::float, 0) as elev_gain,
      (raw_json->>'maxSpeed')::float as max_speed
    FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
      AND raw_json->'activityType'->>'typeKey' NOT IN ('running', 'treadmill_running', 'strength_training')
    ORDER BY (raw_json->>'startTimeLocal')::text DESC
  `;
  return rows;
}

function formatDuration(mins: number) {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function extractSpot(name: string): string {
  // Extract spot from Surfr/Kitesurf session names: "... at Spot: 'X'..."
  const spotMatch = name.match(/Spot:\s*'([^']+)'/);
  if (spotMatch) return spotMatch[1];
  // Extract location from "LocationName Kiteboarding" pattern
  const kiteMatch = name.match(/^(.+?)\s+Kiteboarding$/);
  if (kiteMatch) return kiteMatch[1];
  return "Unknown";
}

function extractJump(name: string): number {
  const match = name.match(/Highest Jump:\s*([\d.]+)\s*m/);
  return match ? parseFloat(match[1]) : 0;
}

function extractResort(name: string): string {
  // "Bansko Snowboard" → "Bansko"
  // "Savoie - Portes du Soleil - Avoriaz 1800 Snowboard" → "Avoriaz"
  // "Kalavryta Resort Snowboarding" → "Kalavryta"
  if (name.includes("Avoriaz") || name.includes("Portes du Soleil") || name.includes("Les")) return "Avoriaz";
  if (name.includes("Bansko")) return "Bansko";
  if (name.includes("Kalavryta")) return "Kalavryta";
  if (name.includes("Akrata")) return "Akrata";
  if (name.includes("Lefkasio")) return "Lefkasio";
  if (name.includes("Vrachní") || name.includes("Elatófyto")) return "Vasilitsa";
  return name.split(" ")[0];
}

export default async function ActivitiesPage() {
  const [summary, kiteSessions, snowSessions, monthlyRaw, activities, yearlySports, cyclingSessions, timeBreakdown, walkingSessions] =
    await Promise.all([
      getActivitySummary(),
      getKiteSessions(),
      getSnowSessions(),
      getMonthlyDistribution(),
      getAllActivities(),
      getYearlySportBreakdown(),
      getCyclingSessions(),
      getTimeBreakdown(),
      getWalkingSessions(),
    ]);

  const totalSessions = summary.reduce((s, r) => s + Number(r.count), 0);
  const totalKm = summary.reduce((s, r) => s + Number(r.total_km || 0), 0);
  const totalHours = summary.reduce((s, r) => s + Number(r.total_hours || 0), 0);
  const totalCal = summary.reduce((s, r) => s + Number(r.total_cal || 0), 0);

  // Build monthly distribution chart data
  const typeToSport: Record<string, string> = {};
  for (const [sport, keys] of Object.entries(SPORT_GROUPS)) {
    for (const k of keys) typeToSport[k] = sport;
  }

  const monthMap = new Map<string, Record<string, number>>();
  const sportSet = new Set<string>();
  for (const row of monthlyRaw) {
    const month = row.month;
    const sport = typeToSport[row.type_key] || row.type_key;
    sportSet.add(sport);
    if (!monthMap.has(month)) monthMap.set(month, {});
    const m = monthMap.get(month)!;
    m[sport] = (m[sport] || 0) + Number(row.count);
  }

  const sports = Array.from(sportSet);
  const monthlyData = Array.from(monthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, counts]) => ({
      month,
      ...Object.fromEntries(sports.map((s) => [s, counts[s] || 0])),
    }));

  // Kite stats
  const kiteData = kiteSessions.map((k: any) => ({
    date: k.date,
    maxSpeedKts: Number(Number(k.max_speed_kts).toFixed(1)),
    distanceKm: Number(Number(k.distance_km).toFixed(1)),
    spot: extractSpot(k.name),
    jump: extractJump(k.name),
    name: k.name,
    durationMin: Number(k.duration_min),
    avgHr: Number(k.avg_hr),
    calories: Number(k.calories),
  }));

  const validKiteSessions = kiteData.filter((k: any) => k.maxSpeedKts > 0);
  const topSpeed = validKiteSessions.length
    ? Math.max(...validKiteSessions.map((k: any) => k.maxSpeedKts))
    : 0;
  const avgSpeed = validKiteSessions.length
    ? validKiteSessions.reduce((s: number, k: any) => s + k.maxSpeedKts, 0) / validKiteSessions.length
    : 0;
  const bestJump = Math.max(...kiteData.map((k: any) => k.jump), 0);
  const totalKiteKm = kiteData.reduce((s: number, k: any) => s + k.distanceKm, 0);

  // Kite spot frequency
  const spotCounts: Record<string, number> = {};
  for (const k of kiteData) {
    spotCounts[k.spot] = (spotCounts[k.spot] || 0) + 1;
  }
  const topSpots = Object.entries(spotCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  // Snow stats
  const snowData = snowSessions.map((s: any) => ({
    name: s.name,
    date: s.date,
    resort: extractResort(s.name),
    distanceKm: Number(Number(s.distance_km).toFixed(1)),
    durationMin: Number(s.duration_min),
    elevGain: Number(s.elev_gain),
    maxSpeedKmh: Number(Number(s.max_speed_kmh).toFixed(1)),
    avgHr: Number(s.avg_hr),
  }));

  const totalVertical = snowData.reduce((s: number, d: any) => s + d.elevGain, 0);
  const topSnowSpeed = snowData.length
    ? Math.max(...snowData.map((d: any) => d.maxSpeedKmh))
    : 0;
  const totalSnowKm = snowData.reduce((s: number, d: any) => s + d.distanceKm, 0);

  // Snow resort frequency
  const resortCounts: Record<string, number> = {};
  for (const d of snowData) {
    resortCounts[d.resort] = (resortCounts[d.resort] || 0) + 1;
  }
  const topResorts = Object.entries(resortCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  return (
    <div className="container mx-auto px-6 py-8 max-w-7xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Activities</h1>
        <p className="text-muted-foreground mt-1">
          Kiteboarding, snowboarding, hiking & more
        </p>
      </div>

      {/* Overview Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard
          title="Total Sessions"
          value={totalSessions}
          icon={<Mountain className="h-4 w-4 text-muted-foreground" />}
        />
        <StatCard
          title="Total Distance"
          value={`${totalKm.toFixed(0)} km`}
          icon={<MapPin className="h-4 w-4 text-blue-400" />}
        />
        <StatCard
          title="Total Time"
          value={`${totalHours.toFixed(0)}h`}
          icon={<Clock className="h-4 w-4 text-green-400" />}
        />
        <StatCard
          title="Total Calories"
          value={`${Math.round(totalCal).toLocaleString()}`}
          subtitle="kcal"
          icon={<Flame className="h-4 w-4 text-orange-400" />}
        />
      </div>

      {/* Monthly Distribution */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Monthly Activity Distribution
          </CardTitle>
        </CardHeader>
        <CardContent>
          <MonthlyActivityChart data={monthlyData} sports={sports} />
        </CardContent>
      </Card>

      {/* Yearly Sport Breakdown */}
      {(yearlySports as any[]).length > 0 && (() => {
        // Group by year
        const yearMap = new Map<number, { type_key: string; count: number; total_km: number; total_hours: number }[]>();
        for (const row of yearlySports as any[]) {
          const year = Number(row.year);
          if (!yearMap.has(year)) yearMap.set(year, []);
          yearMap.get(year)!.push({
            type_key: row.type_key,
            count: Number(row.count),
            total_km: Number(row.total_km || 0),
            total_hours: Number(row.total_hours || 0),
          });
        }
        const years = Array.from(yearMap.keys()).sort((a, b) => b - a);

        const SPORT_COLORS: Record<string, string> = {
          kiteboarding_v2: "bg-cyan-500",
          wind_kite_surfing: "bg-cyan-500",
          resort_snowboarding: "bg-blue-400",
          resort_skiing_snowboarding_ws: "bg-blue-400",
          hiking: "bg-green-500",
          walking: "bg-emerald-400",
          cycling: "bg-yellow-500",
          e_bike_fitness: "bg-yellow-500",
          indoor_cardio: "bg-red-400",
          lap_swimming: "bg-blue-500",
          stand_up_paddleboarding_v2: "bg-cyan-300",
          indoor_cycling: "bg-yellow-400",
          other: "bg-violet-400",
        };

        return (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Activity by Year
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {years.map((year) => {
                  const sports = yearMap.get(year)!;
                  const totalCount = sports.reduce((s, r) => s + r.count, 0);
                  const totalKm = sports.reduce((s, r) => s + r.total_km, 0);
                  const totalHrs = sports.reduce((s, r) => s + r.total_hours, 0);

                  return (
                    <div key={year}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-sm font-semibold">{year}</span>
                        <span className="text-xs text-muted-foreground">
                          {totalCount} sessions · {totalKm.toFixed(0)} km · {totalHrs.toFixed(0)}h
                        </span>
                      </div>
                      {/* Stacked bar */}
                      <div className="flex h-4 rounded-full overflow-hidden mb-1">
                        {sports.map((s) => {
                          const pct = (s.count / totalCount) * 100;
                          const color = SPORT_COLORS[s.type_key] || "bg-muted";
                          return (
                            <div
                              key={s.type_key}
                              className={`${color} transition-all`}
                              style={{ width: `${pct}%` }}
                              title={`${ACTIVITY_LABELS[s.type_key] || s.type_key}: ${s.count}`}
                            />
                          );
                        })}
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                        {sports.map((s) => (
                          <span key={s.type_key} className="text-[10px] text-muted-foreground">
                            {ACTIVITY_LABELS[s.type_key] || s.type_key}: {s.count}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Kiteboarding Deep Dive */}
      {kiteSessions.length > 0 && (
        <div className="mb-6">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
            <Wind className="h-5 w-5 text-cyan-400" />
            Kiteboarding
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <StatCard
              title="Top Speed"
              value={`${topSpeed.toFixed(1)} kts`}
              icon={<Gauge className="h-4 w-4 text-cyan-400" />}
            />
            <StatCard
              title="Avg Max Speed"
              value={`${avgSpeed.toFixed(1)} kts`}
              icon={<Wind className="h-4 w-4 text-cyan-400" />}
            />
            <StatCard
              title="Total Distance"
              value={`${totalKiteKm.toFixed(0)} km`}
              icon={<MapPin className="h-4 w-4 text-cyan-400" />}
            />
            {bestJump > 0 ? (
              <StatCard
                title="Best Jump"
                value={`${bestJump.toFixed(1)}m`}
                icon={<ArrowUp className="h-4 w-4 text-cyan-400" />}
              />
            ) : (
              <StatCard
                title="Sessions"
                value={kiteSessions.length}
                icon={<Trophy className="h-4 w-4 text-cyan-400" />}
              />
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Speed Progression */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Max Speed Progression
                </CardTitle>
              </CardHeader>
              <CardContent>
                <KiteSpeedChart data={kiteData} />
              </CardContent>
            </Card>

            {/* Spots & Sessions */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Spots & Sessions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {topSpots.map(([spot, count]) => (
                    <div key={spot} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <MapPin className="h-3.5 w-3.5 text-cyan-400" />
                        <span className="text-sm">{spot}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <div
                          className="h-2 rounded-full bg-cyan-400/30"
                          style={{
                            width: `${(count / topSpots[0][1]) * 100}px`,
                          }}
                        >
                          <div
                            className="h-full rounded-full bg-cyan-400"
                            style={{
                              width: `${(count / topSpots[0][1]) * 100}%`,
                            }}
                          />
                        </div>
                        <span className="text-sm text-muted-foreground w-8 text-right">
                          {count}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                {/* Jump Records */}
                {kiteData.some((k: any) => k.jump > 0) && (
                  <div className="mt-6 pt-4 border-t border-border">
                    <h4 className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">
                      Jump Records
                    </h4>
                    <div className="space-y-2">
                      {kiteData
                        .filter((k: any) => k.jump > 0)
                        .sort((a: any, b: any) => b.jump - a.jump)
                        .map((k: any, i: number) => (
                          <div
                            key={i}
                            className="flex items-center justify-between text-sm"
                          >
                            <div className="flex items-center gap-2">
                              <ArrowUp className="h-3 w-3 text-cyan-400" />
                              <span>{k.spot}</span>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-muted-foreground">
                                {new Date(k.date).toLocaleDateString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                })}
                              </span>
                              <span className="font-medium">
                                {k.jump.toFixed(2)}m
                              </span>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Snowboarding Deep Dive */}
      {snowSessions.length > 0 && (
        <div className="mb-6">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
            <Snowflake className="h-5 w-5 text-blue-300" />
            Snowboarding
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <StatCard
              title="Total Vertical"
              value={`${totalVertical.toLocaleString()}m`}
              icon={<ArrowUp className="h-4 w-4 text-blue-300" />}
            />
            <StatCard
              title="Top Speed"
              value={`${topSnowSpeed.toFixed(0)} km/h`}
              icon={<Gauge className="h-4 w-4 text-blue-300" />}
            />
            <StatCard
              title="Total Distance"
              value={`${totalSnowKm.toFixed(0)} km`}
              icon={<MapPin className="h-4 w-4 text-blue-300" />}
            />
            <StatCard
              title="Days on Snow"
              value={snowData.length}
              icon={<Snowflake className="h-4 w-4 text-blue-300" />}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Resort breakdown */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Resorts
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {topResorts.map(([resort, count]) => {
                    const resortSessions = snowData.filter(
                      (d: any) => d.resort === resort
                    );
                    const resortVert = resortSessions.reduce(
                      (s: number, d: any) => s + d.elevGain,
                      0
                    );
                    const resortTopSpeed = Math.max(
                      ...resortSessions.map((d: any) => d.maxSpeedKmh)
                    );
                    return (
                      <div key={resort} className="border-b border-border/50 pb-3 last:border-0 last:pb-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium flex items-center gap-2">
                            <Snowflake className="h-3.5 w-3.5 text-blue-300" />
                            {resort}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {count} {count === 1 ? "day" : "days"}
                          </span>
                        </div>
                        <div className="flex gap-4 text-xs text-muted-foreground">
                          {resortVert > 0 && <span>{resortVert.toLocaleString()}m vert</span>}
                          <span>{resortTopSpeed.toFixed(0)} km/h top</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Best sessions */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Best Sessions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {snowData
                    .sort((a: any, b: any) => b.elevGain - a.elevGain)
                    .slice(0, 5)
                    .map((d: any, i: number) => (
                      <div
                        key={i}
                        className="flex items-center justify-between text-sm"
                      >
                        <div>
                          <div className="font-medium">{d.resort}</div>
                          <div className="text-xs text-muted-foreground">
                            {new Date(d.date).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-medium">
                            {d.elevGain > 0
                              ? `${d.elevGain.toLocaleString()}m`
                              : `${d.distanceKm} km`}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {d.maxSpeedKmh.toFixed(0)} km/h ·{" "}
                            {formatDuration(d.durationMin)}
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Total Time Breakdown */}
      {(timeBreakdown as any[]).length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Clock className="h-4 w-4 text-blue-400" />
              Total Training Time Breakdown
              <span className="ml-auto text-xs font-normal">
                {Math.round((timeBreakdown as any[]).reduce((s: number, t: any) => s + Number(t.hours), 0))}h total
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const data = timeBreakdown as any[];
              const totalH = data.reduce((s: number, t: any) => s + Number(t.hours), 0);
              const catColors: Record<string, string> = {
                Gym: "bg-orange-500", Running: "bg-green-500", Walking: "bg-emerald-400",
                Cycling: "bg-yellow-500", Kite: "bg-cyan-500", Snow: "bg-blue-400",
                Cardio: "bg-red-400", Swim: "bg-blue-500", Other: "bg-violet-400",
              };
              return (
                <div>
                  {/* Stacked bar */}
                  <div className="flex h-8 rounded-lg overflow-hidden mb-4">
                    {data.map((t: any) => {
                      const pct = totalH > 0 ? (Number(t.hours) / totalH) * 100 : 0;
                      if (pct < 0.5) return null;
                      return (
                        <div
                          key={t.category}
                          className={`${catColors[t.category] || "bg-gray-500"} flex items-center justify-center`}
                          style={{ width: `${pct}%` }}
                          title={`${t.category}: ${Number(t.hours).toFixed(0)}h (${pct.toFixed(0)}%)`}
                        >
                          {pct > 6 && <span className="text-[10px] font-bold text-black/70">{t.category}</span>}
                        </div>
                      );
                    })}
                  </div>
                  {/* Details grid */}
                  <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
                    {data.map((t: any) => {
                      const hours = Number(t.hours);
                      const pct = totalH > 0 ? ((hours / totalH) * 100).toFixed(0) : "0";
                      return (
                        <div key={t.category} className="flex items-center gap-2">
                          <span className={`w-2.5 h-2.5 rounded-full ${catColors[t.category] || "bg-gray-500"} shrink-0`} />
                          <div className="text-xs">
                            <div className="font-medium">{t.category}</div>
                            <div className="text-muted-foreground">
                              {hours.toFixed(0)}h · {Number(t.sessions)} · {pct}%
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </CardContent>
        </Card>
      )}

      {/* Walking Section */}
      {(walkingSessions as any[]).length >= 5 && (
        <div className="mb-6">
          <h2 className="text-xl font-semibold flex items-center gap-2 mb-4">
            <PersonStanding className="h-5 w-5 text-emerald-400" />
            Walking
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            {(() => {
              const walks = walkingSessions as any[];
              const totalDist = walks.reduce((s: number, w: any) => s + Number(w.distance_km || 0), 0);
              const totalElev = walks.reduce((s: number, w: any) => s + Number(w.elev_gain || 0), 0);
              const avgDuration = walks.reduce((s: number, w: any) => s + Number(w.duration_min || 0), 0) / walks.length;
              const totalCal = walks.reduce((s: number, w: any) => s + Number(w.calories || 0), 0);
              return (
                <>
                  <StatCard title="Total Walks" value={walks.length} icon={<PersonStanding className="h-4 w-4 text-emerald-400" />} />
                  <StatCard title="Total Distance" value={`${totalDist.toFixed(0)} km`} icon={<MapPin className="h-4 w-4 text-blue-400" />} />
                  <StatCard title="Avg Duration" value={formatDuration(avgDuration)} icon={<Clock className="h-4 w-4 text-green-400" />} />
                  <StatCard title="Total Elevation" value={`${totalElev.toFixed(0)}m`} icon={<ArrowUp className="h-4 w-4 text-amber-400" />} />
                </>
              );
            })()}
          </div>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">Recent Walks</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {(walkingSessions as any[]).slice(0, 8).map((w: any, i: number) => (
                  <div key={i} className="flex items-center justify-between text-sm border-b border-border/20 pb-2">
                    <div className="flex items-center gap-2">
                      <PersonStanding className="h-3.5 w-3.5 text-emerald-400" />
                      <span className="font-medium truncate max-w-[200px]">{w.name || "Walking"}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{Number(w.distance_km).toFixed(1)} km</span>
                      <span>{formatDuration(Number(w.duration_min))}</span>
                      {Number(w.elev_gain) > 0 && <span>{Number(w.elev_gain).toFixed(0)}m ↑</span>}
                      <span className="w-20 text-right">{new Date(w.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })}</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Cycling Section */}
      {(cyclingSessions as any[]).length >= 5 && (
        <div className="mb-6">
          <h2 className="text-xl font-semibold flex items-center gap-2 mb-4">
            <Bike className="h-5 w-5 text-yellow-400" />
            Cycling
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            {(() => {
              const rides = cyclingSessions as any[];
              const totalDist = rides.reduce((s: number, r: any) => s + Number(r.distance_km || 0), 0);
              const totalElev = rides.reduce((s: number, r: any) => s + Number(r.elev_gain || 0), 0);
              const topSpeed = Math.max(...rides.filter((r: any) => r.max_speed_kmh).map((r: any) => Number(r.max_speed_kmh)));
              const avgSpeed = rides.filter((r: any) => Number(r.avg_speed_kmh) > 0).reduce((s: number, r: any) => s + Number(r.avg_speed_kmh), 0) / rides.filter((r: any) => Number(r.avg_speed_kmh) > 0).length;
              return (
                <>
                  <StatCard title="Total Rides" value={rides.length} icon={<Bike className="h-4 w-4 text-yellow-400" />} />
                  <StatCard title="Total Distance" value={`${totalDist.toFixed(0)} km`} icon={<MapPin className="h-4 w-4 text-blue-400" />} />
                  <StatCard title="Top Speed" value={`${topSpeed.toFixed(0)} km/h`} icon={<Gauge className="h-4 w-4 text-red-400" />} />
                  <StatCard title="Total Elevation" value={`${totalElev.toFixed(0)}m`} icon={<ArrowUp className="h-4 w-4 text-green-400" />} />
                </>
              );
            })()}
          </div>
          {/* Recent rides */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">Recent Rides</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {(cyclingSessions as any[]).slice(0, 8).map((r: any, i: number) => (
                  <div key={i} className="flex items-center justify-between text-sm border-b border-border/20 pb-2">
                    <div className="flex items-center gap-2">
                      <Bike className="h-3.5 w-3.5 text-yellow-400" />
                      <span className="font-medium truncate max-w-[200px]">{r.name || "Cycling"}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{Number(r.distance_km).toFixed(1)} km</span>
                      <span>{formatDuration(Number(r.duration_min))}</span>
                      {Number(r.avg_speed_kmh) > 0 && <span>{Number(r.avg_speed_kmh).toFixed(0)} km/h</span>}
                      <span className="w-20 text-right">{new Date(r.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })}</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Activity Log */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            All Activities
          </CardTitle>
        </CardHeader>
        <CardContent>
          <PaginatedActivityTable
            activities={(activities as any[]).map((a: any) => ({
              activity_id: a.activity_id,
              type_key: a.type_key,
              date: a.date,
              name: a.name,
              distance_km: Number(a.distance_km),
              duration_min: Number(a.duration_min),
              avg_hr: a.avg_hr ? Number(a.avg_hr) : null,
              calories: a.calories ? Number(a.calories) : null,
              elev_gain: Number(a.elev_gain),
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
