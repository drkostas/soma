import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "edge";

export async function GET() {
  const sql = getDb();

  const rows = await sql`
    SELECT * FROM daily_health_summary
    ORDER BY date DESC
    LIMIT 1
  `;

  if (rows.length === 0) {
    return NextResponse.json({ error: "No data yet" }, { status: 404 });
  }

  return NextResponse.json(rows[0]);
}
