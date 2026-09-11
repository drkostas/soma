import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";


export async function POST(req: NextRequest) {
  const sql = getDb();
  const body = (await req.json()) as {
    date: string;
    run_enabled?: boolean;
    selected_workouts?: string[];
    expected_steps?: number | null;
    /** Ad-hoc planned run distance in km. NULL clears the override and falls back
     *  to training_plan_day.target_distance_km in the plan API read path. */
    planned_run_km?: number | null;
  };
  const { date, run_enabled, selected_workouts, expected_steps, planned_run_km } = body;

  if (!date) {
    return NextResponse.json({ error: "date is required" }, { status: 400 });
  }

  // Ensure nutrition_day row exists
  await sql`
    INSERT INTO nutrition_day (date)
    VALUES (${date})
    ON CONFLICT (date) DO NOTHING
  `;

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

  // Handle ad-hoc planned run distance independently — user can set/clear it
  // without touching the run_enabled/selected_workouts pair. NULL clears the
  // override, in which case the plan API falls back to training_plan_day.
  if (planned_run_km !== undefined) {
    const v = planned_run_km !== null && planned_run_km > 0 ? planned_run_km : null;
    await sql`
      UPDATE nutrition_day SET planned_run_km = ${v} WHERE date = ${date}
    `;
  }

  return NextResponse.json({ ok: true });
}
