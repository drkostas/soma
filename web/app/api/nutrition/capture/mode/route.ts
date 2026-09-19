/** Remember the log-or-calibrate choice, so web, app and widget all start from the same one. */
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function POST(req: NextRequest) {
  const sql = getDb();
  const { mode } = (await req.json()) as { mode?: string };
  const value = mode === "calibrate" ? "calibrate" : "log";
  await sql`UPDATE nutrition_profile SET capture_mode_default = ${value}`;
  return NextResponse.json({ mode: value });
}

export async function GET() {
  const sql = getDb();
  const rows = (await sql`SELECT capture_mode_default FROM nutrition_profile LIMIT 1`) as Array<{ capture_mode_default: string }>;
  return NextResponse.json({ mode: rows[0]?.capture_mode_default ?? "log" });
}
