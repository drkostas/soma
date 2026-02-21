import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/stat-card";
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
  ArrowUpFromDot,
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

async function getSportGroupStats() {
  const sql = getDb();
  const results: Record<string, any> = {};

  for (const [sport, keys] of Object.entries(SPORT_GROUPS)) {
    const rows = await sql`
      SELECT
        COUNT(*) as sessions,
        SUM((raw_json->>'distance')::float) / 1000.0 as total_km,
        SUM((raw_json->>'duration')::float) / 3600.0 as total_hours,
        SUM((raw_json->>'calories')::float) as total_cal,
        AVG((raw_json->>'averageHR')::float) as avg_hr,
        SUM(COALESCE((raw_json->>'elevationGain')::float, 0)) as total_elev,
        MAX((raw_json->>'distance')::float) / 1000.0 as best_distance,
        MAX((raw_json->>'duration')::float) / 3600.0 as longest_session
      FROM garmin_activity_raw
      WHERE endpoint_name = 'summary'
        AND raw_json->'activityType'->>'typeKey' = ANY(${keys})
    `;
    if (rows[0] && Number(rows[0].sessions) > 0) {
      results[sport] = rows[0];
    }
  }

  return results;
}

async function getAllActivities() {
  const sql = getDb();
  const rows = await sql`
    SELECT
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

export default async function ActivitiesPage() {
  const [summary, sportStats, activities] = await Promise.all([
    getActivitySummary(),
    getSportGroupStats(),
    getAllActivities(),
  ]);

  const totalSessions = summary.reduce((s, r) => s + Number(r.count), 0);
  const totalKm = summary.reduce((s, r) => s + Number(r.total_km || 0), 0);
  const totalHours = summary.reduce((s, r) => s + Number(r.total_hours || 0), 0);
  const totalCal = summary.reduce((s, r) => s + Number(r.total_cal || 0), 0);

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
          value={`${totalCal.toLocaleString()}`}
          subtitle="kcal"
          icon={<Flame className="h-4 w-4 text-orange-400" />}
        />
      </div>

      {/* Sport Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {Object.entries(sportStats).map(([sport, stats]) => {
          const keys = SPORT_GROUPS[sport] || [];
          const icon = ACTIVITY_ICONS[keys[0]] || <Mountain className="h-5 w-5" />;
          return (
            <Card key={sport}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  {icon}
                  {sport}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold mb-3">
                  {Number(stats.sessions)} sessions
                </div>
                <div className="grid grid-cols-2 gap-y-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Distance</span>
                    <div className="font-medium">{Number(stats.total_km).toFixed(0)} km</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Time</span>
                    <div className="font-medium">{Number(stats.total_hours).toFixed(1)}h</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Calories</span>
                    <div className="font-medium">{Number(stats.total_cal).toLocaleString()}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Avg HR</span>
                    <div className="font-medium">{Math.round(Number(stats.avg_hr))} bpm</div>
                  </div>
                  {Number(stats.total_elev) > 0 && (
                    <div>
                      <span className="text-muted-foreground">Elevation</span>
                      <div className="font-medium">{Number(stats.total_elev).toLocaleString()}m</div>
                    </div>
                  )}
                  <div>
                    <span className="text-muted-foreground">Best</span>
                    <div className="font-medium">{Number(stats.best_distance).toFixed(1)} km</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Activity Log */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Activity Log
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-2 font-medium">Date</th>
                  <th className="text-left py-2 font-medium">Type</th>
                  <th className="text-left py-2 font-medium">Name</th>
                  <th className="text-right py-2 font-medium">Distance</th>
                  <th className="text-right py-2 font-medium">Duration</th>
                  <th className="text-right py-2 font-medium">HR</th>
                  <th className="text-right py-2 font-medium">Cal</th>
                  <th className="text-right py-2 font-medium">Elev</th>
                </tr>
              </thead>
              <tbody>
                {activities.map((a: any, i: number) => (
                  <tr key={i} className="border-b border-border/50">
                    <td className="py-2 text-muted-foreground whitespace-nowrap">
                      {new Date(a.date).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "2-digit",
                      })}
                    </td>
                    <td className="py-2">
                      <span className="flex items-center gap-1.5">
                        {ACTIVITY_ICONS[a.type_key] || null}
                        <span className="text-xs">
                          {ACTIVITY_LABELS[a.type_key] || a.type_key}
                        </span>
                      </span>
                    </td>
                    <td className="py-2 max-w-[200px] truncate">{a.name}</td>
                    <td className="py-2 text-right">
                      {Number(a.distance_km).toFixed(1)} km
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {formatDuration(Number(a.duration_min))}
                    </td>
                    <td className="py-2 text-right">
                      {a.avg_hr ? Math.round(Number(a.avg_hr)) : "—"}
                    </td>
                    <td className="py-2 text-right text-muted-foreground">
                      {a.calories ? Math.round(Number(a.calories)) : "—"}
                    </td>
                    <td className="py-2 text-right text-muted-foreground">
                      {Number(a.elev_gain) > 0
                        ? `${Number(a.elev_gain).toLocaleString()}m`
                        : "—"}
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
