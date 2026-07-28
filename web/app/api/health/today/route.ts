import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "edge";

export async function GET() {
  const sql = getDb();

  // Today's row often lands with per-field nulls (partial early-morning sync).
  // Merge per-field from the last few days so consumers get the latest known
  // value for every metric instead of dashes next to live charts.
  const rows = (await sql`
    SELECT * FROM daily_health_summary
    ORDER BY date DESC
    LIMIT 7
  `) as Record<string, unknown>[];

  if (rows.length === 0) {
    return NextResponse.json({ error: "No data yet" }, { status: 404 });
  }

  const merged: Record<string, unknown> = { ...rows[0] };
  for (const key of Object.keys(merged)) {
    if (merged[key] == null) {
      for (const older of rows.slice(1)) {
        if (older[key] != null) { merged[key] = older[key]; break; }
      }
    }
  }

  return NextResponse.json(merged);
}
