import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "edge";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get("days") || "30", 10);

  const sql = getDb();

  const rows = await sql`
    SELECT date, weight_grams / 1000.0 as weight_kg, bmi, body_fat_pct
    FROM weight_log
    WHERE date >= CURRENT_DATE - ${days}
    ORDER BY date ASC
  `;

  return NextResponse.json(rows);
}
