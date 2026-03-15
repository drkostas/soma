import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  const sql = getDb();
  const { date, run_enabled, selected_workouts, expected_steps } = (await req.json()) as {
    date: string;
    run_enabled: boolean;
    selected_workouts: string[];
    expected_steps?: number | null;
  };

  if (!date) {
    return NextResponse.json({ error: "date is required" }, { status: 400 });
  }

  // Ensure nutrition_day row exists
  await sql`
    INSERT INTO nutrition_day (date)
    VALUES (${date})
    ON CONFLICT (date) DO NOTHING
  `;

  await sql`
    UPDATE nutrition_day
    SET run_enabled = ${run_enabled},
        selected_workouts = ${selected_workouts},
        expected_steps = ${expected_steps ?? null}
    WHERE date = ${date}
  `;

  return NextResponse.json({ ok: true });
}
