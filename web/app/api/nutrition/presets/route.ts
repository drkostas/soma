import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "edge";

export async function GET() {
  const sql = getDb();

  const [presets, ingredients] = await Promise.all([
    sql`SELECT * FROM preset_meals ORDER BY name`,
    sql`SELECT * FROM ingredients ORDER BY category, name`,
  ]);

  return NextResponse.json({ presets, ingredients });
}
