import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "edge";
export const revalidate = 300;

/* Multi-sport activity summary for the universal (React Native) app. Mirrors the
   data the web /activities server component renders, returned as a JSON rollup so
   the RN screen can consume it over fetch. Runs and strength are excluded from the
   sport rollup (they have their own screens); the time breakdown keeps everything. */

const ACTIVITY_LABELS: Record<string, string> = {
  kiteboarding_v2: "Kiteboarding",
  wind_kite_surfing: "Kiteboarding",
  resort_snowboarding: "Snowboarding",
  resort_skiing_snowboarding_ws: "Snowboarding",
  hiking: "Hiking",
  e_bike_fitness: "E-Bike",
  lap_swimming: "Swimming",
  swimming: "Swimming",
  open_water_swimming: "Swimming",
  walking: "Walking",
  cycling: "Cycling",
  indoor_cardio: "Cardio",
  indoor_cycling: "Indoor Cycle",
  stand_up_paddleboarding_v2: "SUP",
  other: "Other",
};

// Screen sends 30d/90d/1y/all; keep a robust local map (web rangeToDays uses 1m/3m/…).
const RANGE_DAYS: Record<string, number> = { "30d": 30, "90d": 90, "1y": 365, all: 3650 };

function extractJump(name: string | null): number {
  if (!name) return 0;
  const match = name.match(/Highest Jump:\s*([\d.]+)\s*m/);
  return match ? parseFloat(match[1]) : 0;
}

const n = (v: unknown): number => (v == null ? 0 : Number(v));

export async function GET(req: NextRequest) {
  const range = req.nextUrl.searchParams.get("range") ?? "1y";
  const days = RANGE_DAYS[range] ?? 365;
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().split("T")[0];
  const sql = getDb();

  try {
    const [summaryRows, timeRows, activityRows, kiteRows, snowRows] = await Promise.all([
      // Per-sport rollup (excludes runs + strength — those have dedicated screens)
      sql`
        SELECT
          raw_json->'activityType'->>'typeKey' as type_key,
          COUNT(*) as count,
          SUM((raw_json->>'distance')::float) / 1000.0 as total_km,
          SUM((raw_json->>'duration')::float) / 3600.0 as total_hours,
          SUM((raw_json->>'calories')::float) as total_cal
        FROM garmin_activity_raw
        WHERE endpoint_name = 'summary'
          AND raw_json->'activityType'->>'typeKey' NOT IN ('running', 'treadmill_running', 'strength_training')
          AND (raw_json->>'startTimeLocal')::timestamp >= ${cutoff}::date
        GROUP BY type_key
        ORDER BY count DESC
      `,
      // Time-in-sport breakdown across ALL categories
      sql`
        SELECT
          CASE
            WHEN raw_json->'activityType'->>'typeKey' IN ('running', 'treadmill_running') THEN 'Running'
            WHEN raw_json->'activityType'->>'typeKey' = 'strength_training' THEN 'Gym'
            WHEN raw_json->'activityType'->>'typeKey' = 'walking' THEN 'Walking'
            WHEN raw_json->'activityType'->>'typeKey' IN ('cycling', 'e_bike_fitness', 'indoor_cycling') THEN 'Cycling'
            WHEN raw_json->'activityType'->>'typeKey' IN ('kiteboarding_v2', 'wind_kite_surfing') THEN 'Kite'
            WHEN raw_json->'activityType'->>'typeKey' IN ('resort_snowboarding', 'resort_skiing_snowboarding_ws') THEN 'Snow'
            WHEN raw_json->'activityType'->>'typeKey' IN ('lap_swimming', 'swimming', 'open_water_swimming') THEN 'Swim'
            WHEN raw_json->'activityType'->>'typeKey' = 'indoor_cardio' THEN 'Cardio'
            ELSE 'Other'
          END as category,
          SUM((raw_json->>'duration')::float) / 3600.0 as hours,
          COUNT(*) as sessions
        FROM garmin_activity_raw
        WHERE endpoint_name = 'summary'
          AND (raw_json->>'startTimeLocal')::timestamp >= ${cutoff}::date
        GROUP BY category
        ORDER BY hours DESC
      `,
      // Recent sessions list (multi-sport)
      sql`
        SELECT
          activity_id::text as activity_id,
          raw_json->'activityType'->>'typeKey' as type_key,
          (raw_json->>'startTimeLocal')::text as date,
          raw_json->>'activityName' as name,
          (raw_json->>'distance')::float / 1000.0 as distance_km,
          (raw_json->>'duration')::float / 60.0 as duration_min,
          (raw_json->>'averageHR')::float as avg_hr,
          (raw_json->>'calories')::float as calories,
          COALESCE((raw_json->>'elevationGain')::float, 0) as elev_gain
        FROM garmin_activity_raw
        WHERE endpoint_name = 'summary'
          AND raw_json->'activityType'->>'typeKey' NOT IN ('running', 'treadmill_running', 'strength_training')
          AND (raw_json->>'startTimeLocal')::timestamp >= ${cutoff}::date
        ORDER BY (raw_json->>'startTimeLocal')::text DESC
        LIMIT 40
      `,
      // Kite sessions (for the deep-dive aggregate)
      sql`
        SELECT
          raw_json->>'activityName' as name,
          (raw_json->>'maxSpeed')::float * 1.94384 as max_speed_kts,
          (raw_json->>'distance')::float / 1000.0 as distance_km
        FROM garmin_activity_raw
        WHERE endpoint_name = 'summary'
          AND raw_json->'activityType'->>'typeKey' IN ('kiteboarding_v2', 'wind_kite_surfing')
          AND (raw_json->>'startTimeLocal')::timestamp >= ${cutoff}::date
      `,
      // Snow sessions (for the deep-dive aggregate)
      sql`
        SELECT
          (raw_json->>'maxSpeed')::float * 3.6 as max_speed_kmh,
          (raw_json->>'distance')::float / 1000.0 as distance_km,
          COALESCE((raw_json->>'elevationGain')::float, 0) as elev_gain
        FROM garmin_activity_raw
        WHERE endpoint_name = 'summary'
          AND raw_json->'activityType'->>'typeKey' IN ('resort_snowboarding', 'resort_skiing_snowboarding_ws')
          AND (raw_json->>'startTimeLocal')::timestamp >= ${cutoff}::date
      `,
    ]);

    // Multiple type_keys can share a label (kiteboarding_v2 + wind_kite_surfing →
    // "Kiteboarding"); merge them so each sport appears once, mirroring SPORT_GROUPS.
    const sportMap = new Map<
      string,
      { label: string; count: number; total_km: number; total_hours: number; total_cal: number }
    >();
    for (const r of summaryRows) {
      const label = ACTIVITY_LABELS[r.type_key as string] || (r.type_key as string) || "Other";
      const cur = sportMap.get(label) ?? {
        label,
        count: 0,
        total_km: 0,
        total_hours: 0,
        total_cal: 0,
      };
      cur.count += n(r.count);
      cur.total_km += n(r.total_km);
      cur.total_hours += n(r.total_hours);
      cur.total_cal += n(r.total_cal);
      sportMap.set(label, cur);
    }
    const bySport = [...sportMap.values()].sort((a, b) => b.count - a.count);

    const totals = bySport.reduce(
      (t, s) => ({
        sessions: t.sessions + s.count,
        km: t.km + s.total_km,
        hours: t.hours + s.total_hours,
        cal: t.cal + s.total_cal,
      }),
      { sessions: 0, km: 0, hours: 0, cal: 0 },
    );

    const timeBreakdown = timeRows.map((r) => ({
      category: r.category as string,
      hours: n(r.hours),
      sessions: n(r.sessions),
    }));

    const recent = activityRows.map((r) => ({
      activity_id: r.activity_id as string,
      label: ACTIVITY_LABELS[r.type_key as string] || (r.type_key as string) || "Other",
      date: r.date as string,
      name: (r.name as string) ?? null,
      distance_km: n(r.distance_km),
      duration_min: n(r.duration_min),
      avg_hr: r.avg_hr == null ? null : n(r.avg_hr),
      calories: r.calories == null ? null : n(r.calories),
      elev_gain: n(r.elev_gain),
    }));

    const validKite = kiteRows.filter((k) => n(k.max_speed_kts) > 0);
    const kite = kiteRows.length
      ? {
          topSpeedKts: validKite.length ? Math.max(...validKite.map((k) => n(k.max_speed_kts))) : 0,
          avgSpeedKts: validKite.length
            ? validKite.reduce((s, k) => s + n(k.max_speed_kts), 0) / validKite.length
            : 0,
          totalKm: kiteRows.reduce((s, k) => s + n(k.distance_km), 0),
          bestJumpM: Math.max(0, ...kiteRows.map((k) => extractJump(k.name as string | null))),
          sessions: kiteRows.length,
        }
      : null;

    const snow = snowRows.length
      ? {
          totalVerticalM: snowRows.reduce((s, d) => s + n(d.elev_gain), 0),
          topSpeedKmh: Math.max(0, ...snowRows.map((d) => n(d.max_speed_kmh))),
          totalKm: snowRows.reduce((s, d) => s + n(d.distance_km), 0),
          days: snowRows.length,
        }
      : null;

    return NextResponse.json({ totals, bySport, timeBreakdown, recent, kite, snow });
  } catch (err) {
    console.error("activities/summary error:", err);
    return NextResponse.json({ error: "Failed to load activities" }, { status: 500 });
  }
}
