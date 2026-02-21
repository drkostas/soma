import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/stat-card";
import { MonthlyActivityChart } from "@/components/monthly-activity-chart";
import { KiteSpeedChart } from "@/components/kite-speed-chart";
import { ClickableActivityTable } from "@/components/clickable-activity-table";
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
};

const ACTIVITY_LABELS: Record<string, string> = {
  kiteboarding_v2: "Kiteboarding",
  wind_kite_surfing: "Kite Surfing",
  resort_snowboarding: "Snowboarding",
  resort_skiing_snowboarding_ws: "Snowboarding",
  hiking: "Hiking",
  e_bike_fitness: "E-Bike",
  lap_swimming: "Swimming",
};

const SPORT_GROUPS: Record<string, string[]> = {
  Kiteboarding: ["kiteboarding_v2", "wind_kite_surfing"],
  Snowboarding: ["resort_snowboarding", "resort_skiing_snowboarding_ws"],
  Hiking: ["hiking"],
  "E-Bike": ["e_bike_fitness"],
  Swimming: ["lap_swimming"],
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
      AND raw_json->'activityType'->>'typeKey' NOT IN ('running', 'strength_training')
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
      AND raw_json->'activityType'->>'typeKey' NOT IN ('running', 'strength_training')
    GROUP BY month, type_key
    ORDER BY month ASC
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
      AND raw_json->'activityType'->>'typeKey' NOT IN ('running', 'strength_training')
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
  const [summary, kiteSessions, snowSessions, monthlyRaw, activities] =
    await Promise.all([
      getActivitySummary(),
      getKiteSessions(),
      getSnowSessions(),
      getMonthlyDistribution(),
      getAllActivities(),
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

      {/* Activity Log */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            All Activities
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ClickableActivityTable
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
