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
    // When unlocking, reset stale offset values so the plan API recomputes correctly
    if (body.manual_override === false) {
      const profRows = await sql`SELECT daily_deficit FROM nutrition_profile WHERE id = 1`;
      const defaultDeficit = profRows[0]?.daily_deficit != null ? Number(profRows[0].daily_deficit) : 800;
      await sql`UPDATE nutrition_day SET target_calories = NULL, deficit_used = ${defaultDeficit} WHERE date = ${date}`;
    }
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
