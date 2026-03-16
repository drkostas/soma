import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  const sql = getDb();
  const body = (await req.json()) as {
    date: string;
    run_enabled?: boolean;
    selected_workouts?: string[];
    expected_steps?: number | null;
    manual_override?: boolean;
  };
  const { date, run_enabled, selected_workouts, expected_steps } = body;

  if (!date) {
    return NextResponse.json({ error: "date is required" }, { status: 400 });
  }

  // Ensure nutrition_day row exists
  await sql`
    INSERT INTO nutrition_day (date)
    VALUES (${date})
    ON CONFLICT (date) DO NOTHING
  `;

  // Handle manual_override toggle
  if (body.manual_override !== undefined) {
    await sql`UPDATE nutrition_day SET manual_override = ${body.manual_override} WHERE date = ${date}`;
  }

  // Handle activity selection updates (only if fields provided)
  if (run_enabled !== undefined && selected_workouts !== undefined) {
    await sql`
      UPDATE nutrition_day
      SET run_enabled = ${run_enabled},
          selected_workouts = ${selected_workouts},
          expected_steps = ${expected_steps ?? null}
      WHERE date = ${date}
    `;
  }

  return NextResponse.json({ ok: true });
}
