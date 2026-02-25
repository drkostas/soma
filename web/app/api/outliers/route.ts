import { getDb } from "@/lib/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/* ---------- helpers ---------- */

/** Compute the median of a sorted numeric array. */
function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Normalise a date value (Date object or string) to YYYY-MM-DD. */
function normDate(d: unknown): string {
  if (d instanceof Date) return d.toISOString().split("T")[0];
  return String(d).slice(0, 10);
}

/** Round to at most 1 decimal place. */
function r1(v: number): number {
  return Math.round(v * 10) / 10;
}

/* ---------- types ---------- */

interface RawSetRow {
  workout_id: string;
  workout_title: string;
  start_time: unknown;
  exercise_title: string;
  exercise_index: number;
  template_id: string | null;
  set_index: number;
  set_type: string;
  weight_kg: number;
  reps: number;
}

interface SetEntry {
  date: string;
  weight: number;
  reps: number;
  workoutId: string;
  workoutTitle: string;
  exerciseIndex: number;
  setIndex: number;
}

interface Outlier extends SetEntry {
  localMedianWt: number | null;
  flag: "weight_high" | "weight_low" | "reps_high";
  reason: string;
  suggestedValue: number;
  globalMedianReps: number;
}

interface ChartPoint extends SetEntry {
  localMedianWt: number | null;
  isOutlier: boolean;
}

interface ExerciseResult {
  name: string;
  templateId: string | null;
  outlierCount: number;
  totalSets: number;
  globalMedianReps: number;
  outliers: Outlier[];
  chartData: ChartPoint[];
}

/* ---------- main handler ---------- */

export async function GET() {
  const sql = getDb();

  try {
    // Extract all exercises x sets from JSONB, using WITH ORDINALITY for indices
    const rows: RawSetRow[] = (await sql`
      SELECT
        raw_json->>'id'            AS workout_id,
        raw_json->>'title'         AS workout_title,
        raw_json->>'start_time'    AS start_time,
        e.val->>'title'            AS exercise_title,
        (e.idx - 1)::int           AS exercise_index,
        e.val->>'exercise_template_id' AS template_id,
        (s.idx - 1)::int           AS set_index,
        s.val->>'type'             AS set_type,
        COALESCE((s.val->>'weight_kg')::float, 0) AS weight_kg,
        COALESCE((s.val->>'reps')::int, 0)         AS reps
      FROM hevy_raw_data,
        jsonb_array_elements(raw_json->'exercises') WITH ORDINALITY AS e(val, idx),
        jsonb_array_elements(e.val->'sets')          WITH ORDINALITY AS s(val, idx)
      WHERE endpoint_name = 'workout'
      ORDER BY raw_json->>'start_time' ASC, e.idx ASC, s.idx ASC
    `) as unknown as RawSetRow[];

    // Group sets by exercise title
    const byExercise = new Map<
      string,
      { templateId: string | null; sets: (SetEntry & { setType: string })[] }
    >();

    for (const row of rows) {
      const key = row.exercise_title;
      if (!byExercise.has(key)) {
        byExercise.set(key, { templateId: row.template_id, sets: [] });
      }
      byExercise.get(key)!.sets.push({
        date: normDate(row.start_time),
        weight: Number(row.weight_kg),
        reps: Number(row.reps),
        workoutId: row.workout_id,
        workoutTitle: row.workout_title,
        exerciseIndex: Number(row.exercise_index),
        setIndex: Number(row.set_index),
        setType: row.set_type,
      });
    }

    const exercises: ExerciseResult[] = [];
    let totalIssues = 0;

    for (const [name, { templateId, sets }] of byExercise) {
      // Only consider normal sets for analysis
      const normalSets = sets.filter((s) => s.setType === "normal");
      if (normalSets.length === 0) continue;

      const outliers: Outlier[] = [];

      // --- Compute global median reps (for all normal sets) ---
      const allReps = normalSets
        .map((s) => s.reps)
        .filter((r) => r > 0)
        .sort((a, b) => a - b);
      const globalMedianReps = allReps.length > 0 ? median(allReps) : 0;

      // --- Weight outliers: rolling window ---
      const WINDOW = 10; // +/- 10 sets
      const MIN_NEIGHBORS = 5;

      // Pre-extract weights for the window computation
      const weights = normalSets.map((s) => s.weight);

      // For each normal set, compute local median of surrounding window (excl. self)
      const localMedians: (number | null)[] = new Array(normalSets.length).fill(
        null
      );

      for (let i = 0; i < normalSets.length; i++) {
        const lo = Math.max(0, i - WINDOW);
        const hi = Math.min(normalSets.length - 1, i + WINDOW);
        const neighbors: number[] = [];
        for (let j = lo; j <= hi; j++) {
          if (j !== i && weights[j] > 0) {
            neighbors.push(weights[j]);
          }
        }
        if (neighbors.length >= MIN_NEIGHBORS) {
          neighbors.sort((a, b) => a - b);
          localMedians[i] = median(neighbors);
        }
      }

      for (let i = 0; i < normalSets.length; i++) {
        const s = normalSets[i];
        const lm = localMedians[i];

        // Weight outlier check
        if (lm !== null && lm > 0 && s.weight > 0) {
          const ratio = s.weight / lm;
          if (ratio > 3 || ratio < 1 / 3) {
            const flag: "weight_high" | "weight_low" =
              ratio > 1 ? "weight_high" : "weight_low";

            // Determine suggestion
            let suggestedValue: number;
            let explanation: string;

            if (ratio >= 8 && ratio <= 12) {
              // ~10x -> extra digit
              suggestedValue = r1(s.weight / 10);
              explanation = `Likely extra digit \u2014 suggest ${suggestedValue} kg`;
            } else if (ratio >= 1.8 && ratio <= 2.8) {
              // ~2.2x -> lbs entered as kg
              suggestedValue = r1(s.weight / 2.205);
              explanation = `Likely lbs entered as kg \u2014 suggest ${suggestedValue} kg`;
            } else if (ratio >= 0.35 && ratio <= 0.55) {
              // ~0.45x -> kg entered as lbs
              suggestedValue = r1(s.weight * 2.205);
              explanation = `Likely kg entered as lbs \u2014 suggest ${suggestedValue} kg`;
            } else {
              suggestedValue = r1(lm);
              explanation = `suggest ${r1(lm)} kg`;
            }

            const direction = flag === "weight_high" ? "above" : "below";
            outliers.push({
              ...s,
              localMedianWt: r1(lm),
              flag,
              reason: `Weight ${s.weight} kg is ${r1(ratio)}\u00d7 the local median (${r1(lm)} kg), ${direction}. ${explanation}`,
              suggestedValue,
              globalMedianReps,
            });
          }
        }

        // Rep outlier check (global median, need >=10 total sets)
        if (
          normalSets.length >= 10 &&
          globalMedianReps > 0 &&
          s.reps > 0
        ) {
          const repRatio = s.reps / globalMedianReps;
          if (repRatio > 5) {
            let suggestedValue: number;
            let explanation: string;

            if (repRatio >= 8 && repRatio <= 12) {
              suggestedValue = r1(s.reps / 10);
              explanation = `Likely extra digit \u2014 suggest ${r1(s.reps / 10)} reps`;
            } else {
              suggestedValue = r1(globalMedianReps);
              explanation = `suggest ${r1(globalMedianReps)} reps`;
            }

            // Avoid duplicate entry if already flagged for weight
            const alreadyFlagged = outliers.some(
              (o) =>
                o.workoutId === s.workoutId &&
                o.exerciseIndex === s.exerciseIndex &&
                o.setIndex === s.setIndex
            );

            if (!alreadyFlagged) {
              outliers.push({
                ...s,
                localMedianWt: lm !== null ? r1(lm) : null,
                flag: "reps_high",
                reason: `Reps ${s.reps} is ${r1(repRatio)}\u00d7 the global median (${r1(globalMedianReps)}). ${explanation}`,
                suggestedValue,
                globalMedianReps,
              });
            }
          }
        }
      }

      if (outliers.length === 0) continue;

      // Build chart data from ALL normal sets for this exercise
      const outlierKeys = new Set(
        outliers.map(
          (o) => `${o.workoutId}:${o.exerciseIndex}:${o.setIndex}`
        )
      );

      const chartData: ChartPoint[] = normalSets.map((s, i) => ({
        date: s.date,
        weight: s.weight,
        reps: s.reps,
        workoutId: s.workoutId,
        workoutTitle: s.workoutTitle,
        exerciseIndex: s.exerciseIndex,
        setIndex: s.setIndex,
        localMedianWt: localMedians[i] !== null ? r1(localMedians[i]!) : null,
        isOutlier: outlierKeys.has(
          `${s.workoutId}:${s.exerciseIndex}:${s.setIndex}`
        ),
      }));

      totalIssues += outliers.length;

      exercises.push({
        name,
        templateId,
        outlierCount: outliers.length,
        totalSets: normalSets.length,
        globalMedianReps: r1(globalMedianReps),
        outliers,
        chartData,
      });
    }

    // Sort exercises by outlier count descending
    exercises.sort((a, b) => b.outlierCount - a.outlierCount);

    return NextResponse.json({ exercises, totalIssues });
  } catch (error) {
    console.error("Outlier detection error:", error);
    return NextResponse.json(
      { exercises: [], totalIssues: 0, error: "Detection failed" },
      { status: 500 }
    );
  }
}
