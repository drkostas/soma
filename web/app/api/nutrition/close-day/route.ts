import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  const sql = getDb();
  const { date } = (await req.json()) as { date: string };

  if (!date) {
    return NextResponse.json({ error: "date is required" }, { status: 400 });
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

  // Update nutrition_day with actuals and mark closed
  await sql`
    UPDATE nutrition_day
    SET
      actual_calories = ${actual.calories},
      actual_protein  = ${actual.protein},
      actual_carbs    = ${actual.carbs},
      actual_fat      = ${actual.fat},
      actual_fiber    = ${actual.fiber},
      status          = 'closed'
    WHERE date = ${date}
  `;

  // --- Task 9: Recompute deficit from BF% goal when a weigh-in exists ---
  const weightRow = await sql`
    SELECT weight_grams FROM weight_log WHERE date = ${date} LIMIT 1
  `;
  if (weightRow.length > 0) {
    const profile = await sql`
      SELECT estimated_bf_pct, target_bf_pct, target_date
      FROM nutrition_profile WHERE id = 1
    `;
    if (
      profile.length > 0 &&
      profile[0].target_bf_pct != null &&
      profile[0].target_date != null
    ) {
      const newWeightKg = Number(weightRow[0].weight_grams) / 1000;
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
      const cappedDeficit = Math.min(rawDeficit, 500);

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
