import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "edge";

/**
 * Overview extras that the mobile app needs but were server-only on the web
 * page: the latest Garmin Fitness Age (+ chronological/achievable) and the
 * lifetime activity count (Garmin activities minus strength, plus Hevy).
 */
export async function GET() {
  const sql = getDb();

  const fitnessRows = await sql`
    SELECT
      (raw_json->>'fitnessAge')::float          as fitness_age,
      (raw_json->>'chronologicalAge')::int      as chrono_age,
      (raw_json->>'achievableFitnessAge')::float as achievable_age,
      raw_json->'components'                     as components
    FROM garmin_raw_data
    WHERE endpoint_name = 'fitnessage_data'
      AND raw_json->>'fitnessAge' IS NOT NULL
    ORDER BY date DESC
    LIMIT 1
  `;

  const countRows = await sql`
    SELECT
      (SELECT COUNT(*) FROM garmin_activity_raw
        WHERE endpoint_name = 'summary'
          AND COALESCE(raw_json->'activityType'->>'typeKey', '') NOT IN ('strength_training', 'gym'))
      +
      (SELECT COUNT(*) FROM hevy_raw_data WHERE endpoint_name = 'workout') AS total
  `;

  const fitness = (fitnessRows as Record<string, unknown>[])[0] ?? null;

  // Normalize the Garmin fitness-age "components" blob into an ordered list of
  // levers (current value → target, most-impactful first) the app can render.
  const COMPONENT_META: Record<string, { label: string; unit: string }> = {
    rhr: { label: "Resting HR", unit: "bpm" },
    bmi: { label: "BMI", unit: "" },
    vigorousMinutesAvg: { label: "Vigorous min/wk", unit: "min" },
    vigorousDaysAvg: { label: "Vigorous days/wk", unit: "days" },
  };
  const comp = (fitness?.components ?? null) as Record<string, { value?: number; targetValue?: number; priority?: number }> | null;
  const components = comp
    ? Object.entries(comp)
        .filter(([k]) => k in COMPONENT_META)
        .map(([k, v]) => ({
          key: k,
          label: COMPONENT_META[k].label,
          unit: COMPONENT_META[k].unit,
          value: v?.value ?? null,
          target: v?.targetValue ?? null,
          priority: v?.priority ?? null,
        }))
        .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
    : [];

  return NextResponse.json({
    fitness_age: fitness ? (fitness.fitness_age ?? null) : null,
    chrono_age: fitness ? (fitness.chrono_age ?? null) : null,
    achievable_age: fitness ? (fitness.achievable_age ?? null) : null,
    total_activities: Number((countRows as Record<string, unknown>[])[0]?.total ?? 0),
    components,
  });
}
