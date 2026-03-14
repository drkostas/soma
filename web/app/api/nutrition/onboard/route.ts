import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "edge";

/**
 * GET /api/nutrition/onboard
 *
 * Check whether a nutrition_profile exists.
 * - If no profile: bootstrap TDEE, weight, profile info, VO2max, BF%, and
 *   recent Hevy exercises from Garmin + Hevy data.
 * - If profile exists: return it directly.
 */
export async function GET() {
  const sql = getDb();

  const profileRows = await sql`
    SELECT * FROM nutrition_profile WHERE id = 1
  `;

  if (profileRows.length > 0) {
    return NextResponse.json({ profile: profileRows[0] });
  }

  // No profile yet — bootstrap from Garmin + Hevy data
  const [bmrRows, weightRows, vo2maxRows, garminProfileRows] =
    await Promise.all([
      sql`
        SELECT bmr_kilocalories, active_kilocalories
        FROM daily_health_summary
        WHERE bmr_kilocalories IS NOT NULL
        ORDER BY date DESC
        LIMIT 1
      `,
      sql`
        SELECT weight_grams / 1000.0 AS weight_kg, body_fat_pct
        FROM weight_log
        WHERE weight_grams IS NOT NULL
        ORDER BY date DESC
        LIMIT 1
      `,
      sql`
        SELECT vo2max
        FROM fitness_trajectory
        WHERE vo2max IS NOT NULL
        ORDER BY date DESC
        LIMIT 1
      `,
      sql`
        SELECT
          raw_json->'userData'->>'height' AS height_cm,
          raw_json->'userData'->>'birthDate' AS birth_date,
          raw_json->'userData'->>'gender' AS gender,
          raw_json->'userData'->>'vo2MaxRunning' AS vo2max_profile
        FROM garmin_profile_raw
        WHERE endpoint_name = 'user_profile'
        ORDER BY synced_at DESC
        LIMIT 1
      `,
    ]);

  // Fetch Hevy exercises with session counts and template IDs
  let exerciseStats: { name: string; recent: number; total: number; template_id: string }[] = [];
  try {
    const exerciseRows = await sql`
      WITH workout_exercises AS (
        SELECT
          jsonb_array_elements(raw_json->'exercises')->>'title' AS title,
          jsonb_array_elements(raw_json->'exercises')->>'exercise_template_id' AS template_id,
          (raw_json->>'start_time')::timestamptz AS workout_date
        FROM hevy_raw_data
        WHERE endpoint_name = 'workout'
      )
      SELECT
        title AS name,
        MIN(template_id) AS template_id,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE workout_date >= NOW() - INTERVAL '28 days')::int AS recent
      FROM workout_exercises
      WHERE title IS NOT NULL
      GROUP BY title
      ORDER BY recent DESC, total DESC
    `;
    exerciseStats = exerciseRows.map((r: Record<string, unknown>) => ({
      name: r.name as string,
      recent: Number(r.recent),
      total: Number(r.total),
      template_id: r.template_id as string,
    }));
  } catch {
    // Ignore — malformed JSONB or empty table
  }

  const bmr = Number(bmrRows[0]?.bmr_kilocalories) || 0;
  const activeKcal = Number(bmrRows[0]?.active_kilocalories) || 0;
  const tdee = bmr > 0 ? Math.round(bmr + activeKcal * 0.75) : 2300;

  const weightKg = Number(weightRows[0]?.weight_kg) || 80;
  const garminBfPct =
    weightRows[0]?.body_fat_pct != null
      ? Number(weightRows[0].body_fat_pct)
      : null;

  // Use fitness_trajectory first, fall back to Garmin profile vo2MaxRunning
  const vo2FromTrajectory = vo2maxRows[0]?.vo2max != null ? Number(vo2maxRows[0].vo2max) : null;
  const vo2FromProfile = garminProfileRows[0]?.vo2max_profile != null ? Number(garminProfileRows[0].vo2max_profile) : null;
  const vo2max = vo2FromTrajectory ?? vo2FromProfile;

  // Parse Garmin profile
  const heightCm = garminProfileRows[0]?.height_cm != null
    ? Number(garminProfileRows[0].height_cm)
    : null;

  let age: number | null = null;
  if (garminProfileRows[0]?.birth_date) {
    const birth = new Date(garminProfileRows[0].birth_date as string);
    const now = new Date();
    age = now.getFullYear() - birth.getFullYear();
    const monthDiff = now.getMonth() - birth.getMonth();
    if (
      monthDiff < 0 ||
      (monthDiff === 0 && now.getDate() < birth.getDate())
    ) {
      age--;
    }
  }

  const genderRaw = garminProfileRows[0]?.gender as string | undefined;
  const sex =
    genderRaw === "MALE"
      ? "male"
      : genderRaw === "FEMALE"
        ? "female"
        : null;

  // NHANES body-fat estimation
  // BF% = 47.35 + 0.035*age - 11.07*isMale - 0.177*height + 0.191*weight
  //        + 0.345*bmi - 0.137*vo2max
  let estimatedBfPct: number | null = null;
  if (heightCm != null && heightCm > 0 && age != null) {
    const isMale = sex === "male" ? 1 : 0;
    const heightM = heightCm / 100;
    const bmi = weightKg / (heightM * heightM);
    const v = vo2max ?? 40;
    const raw =
      47.35 +
      0.035 * age -
      11.07 * isMale -
      0.177 * heightCm +
      0.191 * weightKg +
      0.345 * bmi -
      0.137 * v;
    estimatedBfPct = Math.round(Math.min(50, Math.max(5, raw)) * 10) / 10;
  }

  return NextResponse.json({
    profile: null,
    bootstrap: {
      tdee,
      weight_kg: weightKg,
      garmin_bf_pct: garminBfPct,
      height_cm: heightCm,
      age,
      sex,
      vo2max,
      estimated_bf_pct: estimatedBfPct,
      exercise_stats: exerciseStats,
    },
  });
}

/**
 * POST /api/nutrition/onboard
 *
 * Save (or update) the nutrition profile with onboarding data.
 * Computes FFM from weight and estimated body-fat percentage.
 */
export async function POST(req: NextRequest) {
  const sql = getDb();
  const body = await req.json();

  const {
    estimated_bf_pct,
    target_bf_pct,
    target_date,
    tdee_estimate,
    daily_deficit,
    weight_kg,
    height_cm,
    age,
    sex,
    vo2max,
    sentinel_exercises,
  } = body as {
    estimated_bf_pct: number;
    target_bf_pct: number;
    target_date: string;
    tdee_estimate: number;
    daily_deficit: number;
    weight_kg: number;
    height_cm?: number;
    age?: number;
    sex?: string;
    vo2max?: number;
    sentinel_exercises?: string[];
  };

  if (
    estimated_bf_pct == null ||
    target_bf_pct == null ||
    tdee_estimate == null ||
    daily_deficit == null ||
    weight_kg == null
  ) {
    return NextResponse.json(
      {
        error:
          "estimated_bf_pct, target_bf_pct, tdee_estimate, daily_deficit, and weight_kg are required",
      },
      { status: 400 },
    );
  }

  // Compute fat-free mass
  const estimatedFfmKg = weight_kg * (1 - estimated_bf_pct / 100);
  const sentinelJson =
    sentinel_exercises != null ? JSON.stringify(sentinel_exercises) : null;

  await sql`
    INSERT INTO nutrition_profile (
      id, weight_kg, estimated_bf_pct, target_bf_pct,
      target_date, tdee_estimate, daily_deficit, estimated_ffm_kg,
      height_cm, age, sex, vo2max, sentinel_exercises,
      updated_at
    ) VALUES (
      1, ${weight_kg}, ${estimated_bf_pct}, ${target_bf_pct},
      ${target_date ?? null}, ${tdee_estimate}, ${daily_deficit}, ${estimatedFfmKg},
      ${height_cm ?? null}, ${age ?? null}, ${sex ?? null},
      ${vo2max ?? null}, ${sentinelJson}::jsonb,
      NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      weight_kg           = EXCLUDED.weight_kg,
      estimated_bf_pct    = EXCLUDED.estimated_bf_pct,
      target_bf_pct       = EXCLUDED.target_bf_pct,
      target_date         = EXCLUDED.target_date,
      tdee_estimate       = EXCLUDED.tdee_estimate,
      daily_deficit       = EXCLUDED.daily_deficit,
      estimated_ffm_kg    = EXCLUDED.estimated_ffm_kg,
      height_cm           = EXCLUDED.height_cm,
      age                 = EXCLUDED.age,
      sex                 = EXCLUDED.sex,
      vo2max              = EXCLUDED.vo2max,
      sentinel_exercises  = EXCLUDED.sentinel_exercises,
      updated_at          = NOW()
  `;

  // Generate today's plan immediately
  const today = new Date().toISOString().slice(0, 10);
  try {
    const baseUrl = process.env.SOMA_WEB_URL || process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3456';
    await fetch(`${baseUrl}/api/nutrition/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: today }),
    });
  } catch {
    // Non-fatal — plan will be generated on next sync
  }

  return NextResponse.json({ saved: true });
}
