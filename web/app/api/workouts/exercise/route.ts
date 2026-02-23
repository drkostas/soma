import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getExerciseMuscles } from "@/lib/muscle-groups";

export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name");
  if (!name) {
    return NextResponse.json({ error: "Missing name parameter" }, { status: 400 });
  }

  const sql = getDb();

  // Get all workouts that contain this exercise, with per-set data
  const rows = await sql`
    WITH matched AS (
      SELECT
        raw_json->>'id' as workout_id,
        raw_json->>'title' as program,
        (raw_json->>'start_time')::date as workout_date,
        raw_json->>'start_time' as start_time,
        e->'sets' as sets
      FROM hevy_raw_data,
        jsonb_array_elements(raw_json->'exercises') as e
      WHERE endpoint_name = 'workout'
        AND e->>'title' = ${name}
      ORDER BY workout_date DESC
    )
    SELECT * FROM matched
  `;

  if (rows.length === 0) {
    return NextResponse.json({ error: "Exercise not found" }, { status: 404 });
  }

  // Get muscle group mapping
  const muscles = getExerciseMuscles(name);

  // Get enrichment data for HR info
  const workoutIds = [...new Set(rows.map(r => r.workout_id))];
  const enrichments = workoutIds.length > 0
    ? await sql`
        SELECT hevy_id, avg_hr, max_hr, calories
        FROM workout_enrichment
        WHERE hevy_id = ANY(${workoutIds})
      `
    : [];
  const enrichMap = new Map(enrichments.map(e => [e.hevy_id, e]));

  // Process each session
  let totalSets = 0;
  let totalReps = 0;
  let maxWeight = { value: 0, date: "", reps: 0 };
  let maxReps = { value: 0, date: "", weight: 0 };
  let maxVolume = { value: 0, date: "", weight: 0, reps: 0 };
  let max1RM = { value: 0, date: "", weight: 0, reps: 0 };

  const progression: {
    date: string;
    workoutId: string;
    program: string;
    maxWeight: number;
    totalVolume: number;
    maxReps: number;
    estimated1RM: number;
    avgHr: number | null;
    sets: { weight: number; reps: number; type: string }[];
  }[] = [];

  for (const row of rows) {
    const sets = typeof row.sets === "string" ? JSON.parse(row.sets) : row.sets;
    const dateStr = row.workout_date instanceof Date
      ? row.workout_date.toISOString().split("T")[0]
      : String(row.workout_date).slice(0, 10);
    const enrichment = enrichMap.get(row.workout_id);

    let sessionMaxWeight = 0;
    let sessionMaxReps = 0;
    let sessionVolume = 0;
    let sessionMax1RM = 0;
    const sessionSets: { weight: number; reps: number; type: string }[] = [];

    for (const s of sets) {
      const w = Number(s.weight_kg || 0);
      const r = Number(s.reps || 0);
      const type = s.type || "normal";
      sessionSets.push({ weight: Math.round(w * 10) / 10, reps: r, type });

      if (type !== "normal" || w <= 0 || r <= 0) continue;

      totalSets++;
      totalReps += r;

      if (w > sessionMaxWeight) sessionMaxWeight = w;
      if (r > sessionMaxReps) sessionMaxReps = r;
      sessionVolume += w * r;

      // Epley 1RM formula: weight × (1 + reps/30)
      const est1RM = r === 1 ? w : w * (1 + r / 30);
      if (est1RM > sessionMax1RM) sessionMax1RM = est1RM;

      // Track all-time records
      if (w > maxWeight.value) {
        maxWeight = { value: w, date: dateStr, reps: r };
      }
      if (r > maxReps.value || (r === maxReps.value && w > maxReps.weight)) {
        maxReps = { value: r, date: dateStr, weight: w };
      }
      if (w * r > maxVolume.value) {
        maxVolume = { value: w * r, date: dateStr, weight: w, reps: r };
      }
      if (est1RM > max1RM.value) {
        max1RM = { value: Math.round(est1RM * 10) / 10, date: dateStr, weight: w, reps: r };
      }
    }

    progression.push({
      date: dateStr,
      workoutId: row.workout_id,
      program: row.program,
      maxWeight: Math.round(sessionMaxWeight * 10) / 10,
      totalVolume: Math.round(sessionVolume),
      maxReps: sessionMaxReps,
      estimated1RM: Math.round(sessionMax1RM * 10) / 10,
      avgHr: enrichment?.avg_hr ? Number(enrichment.avg_hr) : null,
      sets: sessionSets,
    });
  }

  // Reverse so progression goes chronologically (oldest first)
  progression.reverse();

  return NextResponse.json({
    name,
    muscles,
    totalSessions: rows.length,
    totalSets,
    totalReps,
    records: {
      maxWeight,
      maxReps,
      maxVolume,
      estimated1RM: max1RM,
    },
    progression,
  });
}
