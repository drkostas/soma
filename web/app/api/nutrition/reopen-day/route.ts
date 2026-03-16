import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function POST(req: NextRequest) {
  const { date } = await req.json();
  const sql = getDb();
  await sql`UPDATE nutrition_day SET status = 'active' WHERE date = ${date}`;
  return NextResponse.json({ ok: true });
}
