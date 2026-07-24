import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "edge";

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const stddev = (a: number[]) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(mean(a.map((v) => (v - m) ** 2)));
};

/**
 * Sleep schedule (bedtime/wake per night) + regularity stats as JSON for the app
 * (the web computes these from sleep_data timestamps server-side). Mirrors
 * getSleepSchedule + getSleepRegularity in app/sleep/page.tsx.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = searchParams.get("range") || "30d";
  const days = range === "7d" ? 7 : range === "14d" ? 14 : range === "90d" ? 90 : range === "1y" ? 365 : 30;

  const sql = getDb();
  const rows = (await sql`
    SELECT date::text as date,
      (raw_json->'dailySleepDTO'->>'sleepStartTimestampLocal')::bigint as start_ts,
      (raw_json->'dailySleepDTO'->>'sleepEndTimestampLocal')::bigint   as end_ts
    FROM garmin_raw_data
    WHERE endpoint_name = 'sleep_data'
      AND (raw_json->'dailySleepDTO'->>'sleepTimeSeconds')::int > 0
      AND raw_json->'dailySleepDTO'->>'sleepStartTimestampLocal' IS NOT NULL
      AND date >= CURRENT_DATE - ${days}::int
    ORDER BY date ASC
  `) as { date: string; start_ts: string | number; end_ts: string | number }[];

  // Garmin stores local time encoded as UTC timestamps → use UTC getters.
  const schedule = rows.map((r) => {
    const s = new Date(Number(r.start_ts));
    const e = new Date(Number(r.end_ts));
    let bed = s.getUTCHours() + s.getUTCMinutes() / 60;
    if (bed < 12) bed += 24; // early-morning bedtimes count as late-night
    const wake = e.getUTCHours() + e.getUTCMinutes() / 60;
    const dur = (Number(r.end_ts) - Number(r.start_ts)) / 3_600_000;
    return { date: r.date, bedtimeHour: bed, wakeHour: wake, durationHour: dur };
  });

  const beds = schedule.map((x) => x.bedtimeHour);
  const wakes = schedule.map((x) => x.wakeHour);
  const durs = schedule.map((x) => x.durationHour);
  const bStd = stddev(beds);
  const wStd = stddev(wakes);
  const regularityScore = schedule.length >= 3 ? Math.max(0, Math.min(100, Math.round(100 - ((bStd + wStd) / 2) * 30))) : null;

  return NextResponse.json({
    schedule,
    regularity: schedule.length >= 3
      ? {
          avg_bedtime: mean(beds), avg_waketime: mean(wakes), avg_duration: mean(durs),
          bedtime_stddev: bStd, waketime_stddev: wStd, duration_stddev: stddev(durs),
          regularity_score: regularityScore,
        }
      : null,
  });
}
