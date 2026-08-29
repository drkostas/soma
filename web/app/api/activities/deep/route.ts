import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "edge";

/* Sport grouping — mirrors SPORT_GROUPS in app/activities/page.tsx. */
const SPORT_OF: Record<string, string> = {
  kiteboarding_v2: "Kiteboarding", wind_kite_surfing: "Kiteboarding",
  resort_snowboarding: "Snowboarding", resort_skiing_snowboarding_ws: "Snowboarding",
  hiking: "Hiking", e_bike_fitness: "E-Bike",
  lap_swimming: "Swimming", swimming: "Swimming", open_water_swimming: "Swimming",
  walking: "Walking", cycling: "Cycling", indoor_cardio: "Cardio",
  stand_up_paddleboarding_v2: "SUP",
};
const sportOf = (t: string): string => SPORT_OF[t] ?? "Other";

/**
 * Deep activities data as JSON for the app: monthly sport distribution, kite
 * deep-dive (speed points, spots, jumps, wind), and the full activity list.
 * Mirrors getMonthlyDistribution / getKiteSessions / getAllActivities in
 * app/activities/page.tsx (non-run/gym activities).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = searchParams.get("range") || "1y";
  const days =
    range === "1m" || range === "30d" ? 30 :
    range === "3m" || range === "90d" ? 91 :
    range === "6m" ? 182 :
    range === "all" ? 20000 : 365;

  const sql = getDb();

  const monthlyRows = (await sql`
    SELECT TO_CHAR(DATE_TRUNC('month', (raw_json->>'startTimeLocal')::timestamp), 'YYYY-MM') as month,
      raw_json->'activityType'->>'typeKey' as type_key, COUNT(*) as count
    FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
      AND raw_json->'activityType'->>'typeKey' NOT IN ('running', 'treadmill_running', 'strength_training', 'indoor_cycling')
      AND (raw_json->>'startTimeLocal')::timestamp >= CURRENT_DATE - ${days}::int
    GROUP BY 1, 2 ORDER BY 1 ASC
  `) as { month: string; type_key: string; count: number | string }[];

  // pivot: month → {sport: count}
  const monthMap = new Map<string, Record<string, number>>();
  for (const r of monthlyRows) {
    const m = monthMap.get(r.month) ?? {};
    const s = sportOf(r.type_key);
    m[s] = (m[s] ?? 0) + Number(r.count);
    monthMap.set(r.month, m);
  }
  const monthly = [...monthMap.entries()].map(([month, sports]) => ({ month, sports }));

  const kiteRows = (await sql`
    SELECT s.raw_json->>'activityName' as name,
      (s.raw_json->>'startTimeLocal')::text as date,
      (s.raw_json->>'maxSpeed')::float * 1.94384 as max_speed_kts,
      (s.raw_json->>'distance')::float / 1000.0 as distance_km,
      (w.raw_json->>'windSpeed')::float as wind_speed_mps,
      (w.raw_json->>'windGust')::float as wind_gust_mps
    FROM garmin_activity_raw s
    LEFT JOIN garmin_activity_raw w ON w.activity_id = s.activity_id AND w.endpoint_name = 'weather'
    WHERE s.endpoint_name = 'summary'
      AND s.raw_json->'activityType'->>'typeKey' IN ('kiteboarding_v2', 'wind_kite_surfing')
      AND (s.raw_json->>'startTimeLocal')::timestamp >= CURRENT_DATE - ${days}::int
    ORDER BY (s.raw_json->>'startTimeLocal')::text ASC
  `) as { name: string | null; date: string; max_speed_kts: number | null; distance_km: number | null; wind_speed_mps: number | null; wind_gust_mps: number | null }[];

  // parse spot + jump out of the activity name (same regexes as the web page)
  const kiteSessions = kiteRows.map((k) => {
    const name = k.name ?? "";
    const spotMatch = name.match(/Spot: '([^']+)'/) ?? name.match(/^([A-Za-zÀ-ž .-]+?) Kiteboarding/);
    const jumpMatch = name.match(/Highest Jump: ([\d.]+) ?m/);
    return {
      date: k.date,
      spot: spotMatch ? spotMatch[1].trim() : null,
      maxSpeedKts: k.max_speed_kts,
      distanceKm: k.distance_km,
      jumpM: jumpMatch ? Number(jumpMatch[1]) : null,
      windKts: k.wind_speed_mps != null ? k.wind_speed_mps * 1.94384 : null,
      gustKts: k.wind_gust_mps != null ? k.wind_gust_mps * 1.94384 : null,
    };
  });

  const all = (await sql`
    SELECT activity_id, raw_json->'activityType'->>'typeKey' as type_key,
      (raw_json->>'startTimeLocal')::text as date,
      raw_json->>'activityName' as name,
      (raw_json->>'distance')::float / 1000.0 as distance_km,
      (raw_json->>'duration')::float / 60.0 as duration_min,
      (raw_json->>'averageHR')::float as avg_hr,
      (raw_json->>'calories')::float as calories,
      COALESCE((raw_json->>'elevationGain')::float, 0) as elev_gain,
      (raw_json->>'maxSpeed')::float as max_speed_ms,
      (raw_json->>'averageSwolf')::float as swolf
    FROM garmin_activity_raw
    WHERE endpoint_name = 'summary'
      AND raw_json->'activityType'->>'typeKey' NOT IN ('running', 'treadmill_running', 'strength_training', 'indoor_cycling')
      AND (raw_json->>'startTimeLocal')::timestamp >= CURRENT_DATE - ${days}::int
    ORDER BY (raw_json->>'startTimeLocal')::text DESC
    LIMIT ${range === "all" ? 2000 : 200}
  `) as { activity_id: string; type_key: string; date: string; name: string | null; distance_km: number | null; duration_min: number | null; avg_hr: number | null; calories: number | null; elev_gain: number; max_speed_ms: number | null; swolf: number | null }[];

  return NextResponse.json({
    monthly,
    kite: { sessions: kiteSessions },
    all: all.map((a) => ({ ...a, sport: sportOf(a.type_key) })),
  });
}
