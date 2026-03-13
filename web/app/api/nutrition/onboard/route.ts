import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "edge";

/**
 * GET /api/nutrition/onboard
 *
 * Check whether a nutrition_profile exists.
 * - If no profile: bootstrap TDEE and weight from Garmin data.
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

  // No profile yet — bootstrap from Garmin data
  const [bmrRows, weightRows] = await Promise.all([
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
  ]);

  const bmr = Number(bmrRows[0]?.bmr_kilocalories) || 0;
  const activeKcal = Number(bmrRows[0]?.active_kilocalories) || 0;
  const tdee =
    bmr > 0 ? Math.round(bmr + activeKcal * 0.75) : 2300;

  const weightKg = Number(weightRows[0]?.weight_kg) || 80;
  const garminBfPct = weightRows[0]?.body_fat_pct != null
    ? Number(weightRows[0].body_fat_pct)
    : null;

  return NextResponse.json({
    profile: null,
    bootstrap: {
      tdee,
      weight_kg: weightKg,
      garmin_bf_pct: garminBfPct,
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
  } = body as {
    estimated_bf_pct: number;
    target_bf_pct: number;
    target_date: string;
    tdee_estimate: number;
    daily_deficit: number;
    weight_kg: number;
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

  await sql`
    INSERT INTO nutrition_profile (
      id, weight_kg, estimated_bf_pct, target_bf_pct,
      target_date, tdee_estimate, daily_deficit, estimated_ffm_kg,
      updated_at
    ) VALUES (
      1, ${weight_kg}, ${estimated_bf_pct}, ${target_bf_pct},
      ${target_date ?? null}, ${tdee_estimate}, ${daily_deficit}, ${estimatedFfmKg},
      NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      weight_kg        = EXCLUDED.weight_kg,
      estimated_bf_pct = EXCLUDED.estimated_bf_pct,
      target_bf_pct    = EXCLUDED.target_bf_pct,
      target_date      = EXCLUDED.target_date,
      tdee_estimate    = EXCLUDED.tdee_estimate,
      daily_deficit    = EXCLUDED.daily_deficit,
      estimated_ffm_kg = EXCLUDED.estimated_ffm_kg,
      updated_at       = NOW()
  `;

  return NextResponse.json({ saved: true });
}
