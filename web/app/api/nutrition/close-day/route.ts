import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  const sql = getDb();
  const { date } = (await req.json()) as { date: string };

  if (!date) {
    return NextResponse.json({ error: "date is required" }, { status: 400 });
  }

  // Idempotency: don't re-close an already closed day
  const existing = await sql`SELECT status FROM nutrition_day WHERE date = ${date}`;
  if (existing[0]?.status === "closed") {
    return NextResponse.json({ status: "already_closed", message: "Day is already closed" });
  }

  // Sum meal totals
  const mealTotals = await sql`
    SELECT
      COALESCE(SUM(calories), 0) AS calories,
      COALESCE(SUM(protein), 0)  AS protein,
      COALESCE(SUM(carbs), 0)    AS carbs,
      COALESCE(SUM(fat), 0)      AS fat,
      COALESCE(SUM(fiber), 0)    AS fiber
    FROM meal_log
    WHERE date = ${date}
  `;

  // Sum drink totals
  const drinkTotals = await sql`
    SELECT
      COALESCE(SUM(calories), 0) AS calories,
      COALESCE(SUM(carbs), 0)    AS carbs
    FROM drink_log
    WHERE date = ${date}
  `;

  const m = mealTotals[0];
  const d = drinkTotals[0];

  const actual = {
    calories: Math.round(Number(m.calories) + Number(d.calories)),
    protein: Math.round(Number(m.protein)),
    carbs: Math.round(Number(m.carbs) + Number(d.carbs)),
    fat: Math.round(Number(m.fat)),
    fiber: Math.round(Number(m.fiber)),
  };

  // ── Reconcile with actual activity data ──
  let actualSteps = 0;
  let actualRunCalories = 0;
  let actualGymCalories = 0;

  try {
    // Actual steps from Garmin
    const stepsRow = await sql`
      SELECT total_steps FROM daily_health_summary WHERE date = ${date}
    `;
    actualSteps = Number(stepsRow[0]?.total_steps) || 0;

    // Actual run calories from Garmin activities for this date
    const runCalRow = await sql`
      SELECT SUM((raw_json->>'calories')::float) AS total_run_cal
      FROM garmin_activity_raw
      WHERE endpoint_name = 'activity_detail'
        AND (raw_json->>'startTimeLocal')::date = ${date}::date
        AND raw_json->>'activityType' IN ('running', 'trail_running', 'treadmill_running')
    `;
    actualRunCalories = Math.round(Number(runCalRow[0]?.total_run_cal) || 0);

    // Actual gym calories from workout_enrichment
    const gymCalRow = await sql`
      SELECT SUM(calories) AS total_gym_cal
      FROM workout_enrichment
      WHERE workout_date = ${date}
    `;
    actualGymCalories = Math.round(Number(gymCalRow[0]?.total_gym_cal) || 0);
  } catch {
    // Graceful — tables may not exist in demo
  }

  // Store reconciliation data in the plan JSONB
  const existingPlanRow = await sql`SELECT plan FROM nutrition_day WHERE date = ${date}`;
  const existingPlan = (existingPlanRow[0]?.plan as Record<string, unknown>) || {};
  const reconciledPlan = {
    ...existingPlan,
    reconciled: {
      actual_steps: actualSteps,
      actual_run_calories: actualRunCalories,
      actual_gym_calories: actualGymCalories,
      reconciled_at: new Date().toISOString(),
    },
  };

  // Update nutrition_day with actuals, reconciliation data, and mark closed
  await sql`
    UPDATE nutrition_day
    SET
      actual_calories = ${actual.calories},
      actual_protein  = ${actual.protein},
      actual_carbs    = ${actual.carbs},
      actual_fat      = ${actual.fat},
      actual_fiber    = ${actual.fiber},
      plan            = ${JSON.stringify(reconciledPlan)},
      status          = 'closed'
    WHERE date = ${date}
  `;

  // --- Task 9: Recompute deficit from BF% goal when a weigh-in exists ---
  const weightRow = await sql`
    SELECT weight_grams FROM weight_log WHERE date = ${date} LIMIT 1
  `;
  if (weightRow.length > 0) {
    const newWeightKg = Number(weightRow[0].weight_grams) / 1000;

    // Update analytics_weight_trend with 7-day average
    const trend = await sql`
      SELECT AVG(weight_grams) as avg_7d
      FROM weight_log
      WHERE date >= ${date}::date - interval '7 days' AND date <= ${date}::date
    `;
    const avg7d = trend[0]?.avg_7d ? Number(trend[0].avg_7d) / 1000.0 : newWeightKg;
    await sql`
      INSERT INTO analytics_weight_trend (date, weight_kg, avg_7d)
      VALUES (${date}, ${newWeightKg}, ${avg7d})
      ON CONFLICT (date) DO UPDATE SET
        weight_kg = EXCLUDED.weight_kg,
        avg_7d = EXCLUDED.avg_7d
    `;

    // Recompute deficit from BF% goal
    const profile = await sql`
      SELECT estimated_bf_pct, target_bf_pct, target_date
      FROM nutrition_profile WHERE id = 1
    `;
    if (
      profile.length > 0 &&
      profile[0].target_bf_pct != null &&
      profile[0].target_date != null
    ) {
      const currentBf = Number(profile[0].estimated_bf_pct) || 17;
      const targetBf = Number(profile[0].target_bf_pct);

      // Constant-FFM model: fat-free mass stays the same
      const ffm = newWeightKg * (1 - currentBf / 100);
      const targetWeight = ffm / (1 - targetBf / 100);
      const fatToLose = Math.max(0, newWeightKg - targetWeight);

      const daysLeft = Math.max(
        1,
        Math.ceil(
          (new Date(profile[0].target_date).getTime() -
            new Date(date).getTime()) /
            86400000
        )
      );
      const rawDeficit = (fatToLose * 7700) / daysLeft;
      const currentDeficit = Number(profile[0].daily_deficit) || 800;
      const cappedDeficit = Math.min(rawDeficit, currentDeficit);

      // Derive updated BF% from new weight (FFM unchanged)
      const newBfPct = Math.round(((newWeightKg - ffm) / newWeightKg) * 1000) / 10;

      await sql`
        UPDATE nutrition_profile SET
          weight_kg = ${newWeightKg},
          estimated_bf_pct = ${newBfPct},
          daily_deficit = ${Math.round(cappedDeficit)},
          updated_at = NOW()
        WHERE id = 1
      `;
    }
  }

  return NextResponse.json({ status: "closed", actual });
}
