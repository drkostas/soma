import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { workoutId, exerciseIndex, setIndex, field, newValue } =
    await req.json();

  if (
    !workoutId ||
    exerciseIndex == null ||
    setIndex == null ||
    !field ||
    newValue == null
  ) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  if (field !== "weight_kg" && field !== "reps") {
    return NextResponse.json({ error: "Invalid field" }, { status: 400 });
  }

  const sql = getDb();

  // 1. Fetch current workout JSON
  const rows = await sql`
    SELECT raw_json
    FROM hevy_raw_data
    WHERE endpoint_name = 'workout'
      AND raw_json->>'id' = ${workoutId}
    LIMIT 1
  `;

  if (!rows.length) {
    return NextResponse.json({ error: "Workout not found" }, { status: 404 });
  }

  const workout = rows[0].raw_json;
  const exercise = workout.exercises?.[exerciseIndex];
  if (!exercise) {
    return NextResponse.json({ error: "Exercise not found" }, { status: 404 });
  }
  const set = exercise.sets?.[setIndex];
  if (!set) {
    return NextResponse.json({ error: "Set not found" }, { status: 404 });
  }

  // 2. Apply the fix
  const oldValue = set[field];
  set[field] = newValue;

  // 3. Update our DB
  await sql`
    UPDATE hevy_raw_data
    SET raw_json = ${JSON.stringify(workout)}::jsonb
    WHERE endpoint_name = 'workout'
      AND raw_json->>'id' = ${workoutId}
  `;

  // 4. Update Hevy API via PUT
  let updatedHevy = false;
  const hevyApiKey = process.env.HEVY_API_KEY;

  if (hevyApiKey) {
    try {
      const putBody = {
        workout: {
          title: workout.title,
          description: workout.description || null,
          start_time: workout.start_time,
          end_time: workout.end_time,
          is_private: false,
          exercises: workout.exercises.map((ex: any) => ({
            exercise_template_id: ex.exercise_template_id,
            superset_id: ex.superset_id || null,
            notes: ex.notes || null,
            sets: ex.sets.map((s: any) => ({
              type: s.type,
              weight_kg: s.weight_kg,
              reps: s.reps,
              distance_meters: s.distance_meters,
              duration_seconds: s.duration_seconds,
              rpe: s.rpe,
            })),
          })),
        },
      };

      const res = await fetch(
        `https://api.hevyapp.com/v1/workouts/${workoutId}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "api-key": hevyApiKey,
          },
          body: JSON.stringify(putBody),
        }
      );

      if (res.ok) {
        updatedHevy = true;
      } else {
        console.error(
          "Hevy PUT failed:",
          res.status,
          await res.text().catch(() => "")
        );
      }
    } catch (e) {
      console.error("Hevy PUT error:", e);
    }
  }

  return NextResponse.json({
    success: true,
    updatedHevy,
    oldValue,
    newValue,
    field,
  });
}
