import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "edge";

/**
 * Per-night sleep data as JSON so the native app can render the sleep dashboard
 * (the web page reads garmin_raw_data server-side; the RN app has no DB). Mirrors
 * the sleep_data queries in app/sleep/page.tsx: stages, score, sleep HR, SpO2.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = searchParams.get("range") || "30d";
  const days = range === "7d" ? 7 : range === "14d" ? 14 : range === "90d" ? 90 : range === "1y" ? 365 : 30;

  const sql = getDb();
  const rows = (await sql`
    SELECT date,
      (raw_json->'dailySleepDTO'->>'sleepTimeSeconds')::int         as total,
      (raw_json->'dailySleepDTO'->>'deepSleepSeconds')::int         as deep,
      (raw_json->'dailySleepDTO'->>'lightSleepSeconds')::int        as light,
      (raw_json->'dailySleepDTO'->>'remSleepSeconds')::int          as rem,
      (raw_json->'dailySleepDTO'->>'awakeSleepSeconds')::int        as awake,
      (raw_json->'dailySleepDTO'->'sleepScores'->'overall'->>'value')::int as score,
      (raw_json->'dailySleepDTO'->>'avgHeartRate')::float           as hr,
      (raw_json->'dailySleepDTO'->>'averageSpO2Value')::float       as spo2
    FROM garmin_raw_data
    WHERE endpoint_name = 'sleep_data'
      AND (raw_json->'dailySleepDTO'->>'sleepTimeSeconds')::int > 0
      AND date >= CURRENT_DATE - ${days}::int
    ORDER BY date ASC
  `) as {
    date: string; total: number | null; deep: number | null; light: number | null;
    rem: number | null; awake: number | null; score: number | null; hr: number | null; spo2: number | null;
  }[];

  // aggregate stats over the window (nulls ignored per-field)
  const avg = (vals: (number | null | undefined)[]) => {
    const nn = vals.filter((v): v is number => v != null && isFinite(v));
    return nn.length ? nn.reduce((a, b) => a + b, 0) / nn.length : null;
  };
  const stats = {
    nights: rows.length,
    avg_hours: avg(rows.map((r) => (r.total != null ? r.total / 3600 : null))),
    avg_score: avg(rows.map((r) => r.score)),
    avg_deep_pct: avg(rows.map((r) => (r.total ? ((r.deep ?? 0) / r.total) * 100 : null))),
    avg_rem_pct: avg(rows.map((r) => (r.total ? ((r.rem ?? 0) / r.total) * 100 : null))),
    avg_sleep_hr: avg(rows.map((r) => r.hr)),
    avg_spo2: avg(rows.map((r) => r.spo2)),
  };
  const lastNight = rows.length ? rows[rows.length - 1] : null;

  return NextResponse.json({ trend: rows, stats, lastNight });
}
