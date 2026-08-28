import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "edge";

/**
 * This-week vs last-week training summary + current training streak, for the
 * overview "This Week" card (mobile app + anything else that needs the totals).
 * Mirrors the server-side aggregation the web overview page computes inline.
 */
export async function GET() {
  const sql = getDb();

  const weekRows = await sql`
    WITH week_data AS (
      SELECT
        CASE
          WHEN (raw_json->>'startTimeLocal')::timestamp >= DATE_TRUNC('week', CURRENT_DATE)
          THEN 'this_week'
          ELSE 'last_week'
        END as period,
        (raw_json->>'duration')::float / 3600.0 as hours,
        (raw_json->>'distance')::float / 1000.0 as km,
        (raw_json->>'calories')::float as cal
      FROM garmin_activity_raw
      WHERE endpoint_name = 'summary'
        AND (raw_json->>'startTimeLocal')::timestamp >= DATE_TRUNC('week', CURRENT_DATE) - INTERVAL '7 days'
    )
    SELECT
      period,
      COUNT(*) as sessions,
      ROUND(SUM(hours)::numeric, 1) as total_hours,
      ROUND(SUM(km)::numeric, 0) as total_km,
      ROUND(SUM(cal)::numeric, 0) as total_cal
    FROM week_data
    GROUP BY period
  `;
  const byPeriod: Record<string, unknown> = {};
  for (const r of weekRows as Record<string, unknown>[]) byPeriod[String(r.period)] = r;

  const dayRows = (await sql`
    SELECT DISTINCT day FROM (
      SELECT LEFT((raw_json->>'startTimeLocal')::text, 10) as day
      FROM garmin_activity_raw WHERE endpoint_name = 'summary'
      UNION
      SELECT LEFT((raw_json->>'start_time')::text, 10) as day
      FROM hevy_raw_data WHERE endpoint_name = 'workout'
    ) combined
    ORDER BY day DESC
    LIMIT 90
  `) as { day: string }[];

  let streak = 0;
  if (dayRows.length) {
    const days = new Set(dayRows.map((r) => r.day));
    const d = new Date();
    const todayStr = d.toISOString().slice(0, 10);
    if (!days.has(todayStr)) d.setDate(d.getDate() - 1);
    while (days.has(d.toISOString().slice(0, 10))) {
      streak++;
      d.setDate(d.getDate() - 1);
    }
  }

  return NextResponse.json({
    this_week: byPeriod.this_week ?? null,
    last_week: byPeriod.last_week ?? null,
    streak,
  });
}
