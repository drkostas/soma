import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "edge";
export const revalidate = 300;

/* 14-day trend series for the universal app's Home (overview) tier-1 KPI cards.
   One pass over daily_health_summary, returned as value-only arrays (chronological)
   the RN Sparkline consumes. Nulls are dropped per-series by the sparkline. */

const n = (v: unknown): number | null => (v == null ? null : Number(v));

export async function GET() {
  const sql = getDb();
  try {
    const rows = await sql`
      SELECT
        date::text as date,
        total_steps,
        active_kilocalories,
        resting_heart_rate,
        avg_stress_level,
        body_battery_max,
        COALESCE(moderate_intensity_minutes, 0) + COALESCE(vigorous_intensity_minutes, 0) as intensity
      FROM daily_health_summary
      WHERE date >= CURRENT_DATE - make_interval(days => 14)
      ORDER BY date ASC
    `;
    const pick = (k: string) =>
      rows.map((r) => n(r[k])).filter((v): v is number => v != null && isFinite(v) && v > 0);
    return NextResponse.json({
      steps: pick("total_steps"),
      calories: pick("active_kilocalories"),
      rhr: pick("resting_heart_rate"),
      stress: pick("avg_stress_level"),
      bodyBattery: pick("body_battery_max"),
      intensity: rows.map((r) => n(r.intensity)).filter((v): v is number => v != null && isFinite(v)),
    });
  } catch (err) {
    console.error("overview/trends error:", err);
    return NextResponse.json({ error: "Failed to load trends" }, { status: 500 });
  }
}
