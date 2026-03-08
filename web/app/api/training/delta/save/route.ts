import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "edge";

interface DeltaWorkoutInput {
  dayId: number;
  newPace?: number;
  newDistance?: number;
  newType?: string;
  workoutSteps?: unknown;
}

interface SaveBody {
  sliderFactor?: number;
  updatedWorkouts: DeltaWorkoutInput[];
}

/**
 * POST /api/training/delta/save
 *
 * Persists delta-simulator changes to training_plan_day rows.
 * For each changed workout:
 *   - Updates workout_steps, target_distance_km, run_type
 *   - Sets garmin_push_status = 'pending' so the next sync pushes to Garmin
 *
 * Body: { sliderFactor?: number, updatedWorkouts: DeltaWorkoutInput[] }
 * Returns: { ok: true, updated: number, message: string }
 */
export async function POST(request: Request) {
  let body: SaveBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const { updatedWorkouts } = body;

  if (!Array.isArray(updatedWorkouts) || updatedWorkouts.length === 0) {
    return NextResponse.json(
      { ok: false, error: "updatedWorkouts must be a non-empty array" },
      { status: 400 },
    );
  }

  // Validate all day IDs are positive integers
  for (const w of updatedWorkouts) {
    if (!Number.isInteger(w.dayId) || w.dayId < 1) {
      return NextResponse.json(
        { ok: false, error: `Invalid dayId: ${w.dayId}` },
        { status: 400 },
      );
    }
  }

  const sql = getDb();
  let updated = 0;

  for (const w of updatedWorkouts) {
    const hasDistance = w.newDistance != null;
    const hasType = w.newType != null;
    const hasSteps = w.workoutSteps != null;

    // Always mark as pending for Garmin push
    if (hasDistance || hasType || hasSteps) {
      await sql`
        UPDATE training_plan_day
        SET
          target_distance_km = CASE WHEN ${hasDistance} THEN ${w.newDistance ?? null}::float ELSE target_distance_km END,
          run_type = CASE WHEN ${hasType} THEN ${w.newType ?? null}::varchar ELSE run_type END,
          workout_steps = CASE WHEN ${hasSteps} THEN ${JSON.stringify(w.workoutSteps)}::jsonb ELSE workout_steps END,
          garmin_push_status = 'pending'
        WHERE id = ${w.dayId}
      `;
      updated++;
    }
  }

  return NextResponse.json({
    ok: true,
    updated,
    message: `${updated} workout${updated === 1 ? "" : "s"} updated and marked for Garmin push.`,
  });
}
