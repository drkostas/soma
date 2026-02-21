import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "edge";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface DayData {
  day: string;
  date: string;
  sessions: number;
  hours: number;
  km: number;
  calories: number;
}

export async function GET() {
  const sql = getDb();

  try {
    // Get per-day activity data for this week and last week
    const rows = await sql`
      SELECT
        (raw_json->>'startTimeLocal')::date as activity_date,
        COUNT(*)::int as sessions,
        COALESCE(SUM((raw_json->>'duration')::float / 3600.0), 0) as hours,
        COALESCE(SUM((raw_json->>'distance')::float / 1000.0), 0) as km,
        COALESCE(SUM((raw_json->>'calories')::float), 0) as calories
      FROM garmin_activity_raw
      WHERE endpoint_name = 'summary'
        AND (raw_json->>'startTimeLocal')::timestamp >= DATE_TRUNC('week', CURRENT_DATE) - INTERVAL '7 days'
      GROUP BY activity_date
      ORDER BY activity_date ASC
    `;

    // Build a map of date -> data
    const dataByDate: Record<string, { sessions: number; hours: number; km: number; calories: number }> = {};
    for (const row of rows) {
      const dateStr = typeof row.activity_date === "string"
        ? row.activity_date.slice(0, 10)
        : new Date(row.activity_date).toISOString().slice(0, 10);
      dataByDate[dateStr] = {
        sessions: Number(row.sessions),
        hours: Math.round(Number(row.hours) * 100) / 100,
        km: Math.round(Number(row.km) * 100) / 100,
        calories: Math.round(Number(row.calories)),
      };
    }

    // Compute the start of this week (Monday) and last week (Monday)
    // Using JS date math - DATE_TRUNC('week', ...) in PostgreSQL returns Monday
    const now = new Date();
    // Get current day of week (0=Sun, 1=Mon, ..., 6=Sat)
    const currentDow = now.getUTCDay();
    // Calculate Monday of this week
    const mondayOffset = currentDow === 0 ? 6 : currentDow - 1;
    const thisWeekMonday = new Date(now);
    thisWeekMonday.setUTCDate(now.getUTCDate() - mondayOffset);
    thisWeekMonday.setUTCHours(0, 0, 0, 0);

    const lastWeekMonday = new Date(thisWeekMonday);
    lastWeekMonday.setUTCDate(thisWeekMonday.getUTCDate() - 7);

    // Build 7-day arrays for both weeks
    const thisWeek: DayData[] = [];
    const lastWeek: DayData[] = [];

    for (let i = 0; i < 7; i++) {
      const twDate = new Date(thisWeekMonday);
      twDate.setUTCDate(thisWeekMonday.getUTCDate() + i);
      const twDateStr = twDate.toISOString().slice(0, 10);
      const twData = dataByDate[twDateStr];

      thisWeek.push({
        day: DAY_NAMES[i],
        date: twDateStr,
        sessions: twData?.sessions ?? 0,
        hours: twData?.hours ?? 0,
        km: twData?.km ?? 0,
        calories: twData?.calories ?? 0,
      });

      const lwDate = new Date(lastWeekMonday);
      lwDate.setUTCDate(lastWeekMonday.getUTCDate() + i);
      const lwDateStr = lwDate.toISOString().slice(0, 10);
      const lwData = dataByDate[lwDateStr];

      lastWeek.push({
        day: DAY_NAMES[i],
        date: lwDateStr,
        sessions: lwData?.sessions ?? 0,
        hours: lwData?.hours ?? 0,
        km: lwData?.km ?? 0,
        calories: lwData?.calories ?? 0,
      });
    }

    // Compute totals
    const sum = (arr: DayData[], key: keyof Omit<DayData, "day" | "date">) =>
      arr.reduce((s, d) => s + d[key], 0);

    const totals = {
      this_week: {
        sessions: sum(thisWeek, "sessions"),
        hours: Math.round(sum(thisWeek, "hours") * 10) / 10,
        km: Math.round(sum(thisWeek, "km")),
        calories: Math.round(sum(thisWeek, "calories")),
      },
      last_week: {
        sessions: sum(lastWeek, "sessions"),
        hours: Math.round(sum(lastWeek, "hours") * 10) / 10,
        km: Math.round(sum(lastWeek, "km")),
        calories: Math.round(sum(lastWeek, "calories")),
      },
    };

    return NextResponse.json({
      this_week: thisWeek,
      last_week: lastWeek,
      totals,
    });
  } catch (err) {
    console.error("Error fetching weekly comparison:", err);
    return NextResponse.json(
      { error: "Failed to fetch weekly comparison data" },
      { status: 500 }
    );
  }
}
