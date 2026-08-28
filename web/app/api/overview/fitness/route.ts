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
      (raw_json->>'achievableFitnessAge')::float as achievable_age
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
  return NextResponse.json({
    fitness_age: fitness ? (fitness.fitness_age ?? null) : null,
    chrono_age: fitness ? (fitness.chrono_age ?? null) : null,
    achievable_age: fitness ? (fitness.achievable_age ?? null) : null,
    total_activities: Number((countRows as Record<string, unknown>[])[0]?.total ?? 0),
  });
}
