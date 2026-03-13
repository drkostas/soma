import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const sql = getDb();
  const date =
    req.nextUrl.searchParams.get("date") ??
    new Date().toISOString().slice(0, 10);

  const [planRows, mealRows, drinkRows] = await Promise.all([
    sql`SELECT * FROM nutrition_day WHERE date = ${date}`,
    sql`SELECT * FROM meal_log WHERE date = ${date} ORDER BY logged_at`,
    sql`SELECT * FROM drink_log WHERE date = ${date} ORDER BY logged_at`,
  ]);

  const plan = planRows[0] ?? null;

  // Sum consumed macros from meals + drinks
  let calories = 0,
    protein = 0,
    carbs = 0,
    fat = 0,
    fiber = 0;

  for (const m of mealRows) {
    calories += Number(m.calories) || 0;
    protein += Number(m.protein) || 0;
    carbs += Number(m.carbs) || 0;
    fat += Number(m.fat) || 0;
    fiber += Number(m.fiber) || 0;
  }
  for (const d of drinkRows) {
    calories += Number(d.calories) || 0;
    carbs += Number(d.carbs) || 0;
  }

  const consumed = {
    calories: Math.round(calories),
    protein: Math.round(protein),
    carbs: Math.round(carbs),
    fat: Math.round(fat),
    fiber: Math.round(fiber),
  };

  // Remaining = plan targets minus consumed (fiber target from profile if available)
  let remaining: Record<string, number> | null = null;
  if (plan) {
    const profileRows = await sql`
      SELECT target_fiber FROM nutrition_profile WHERE id = 1
    `;
    const targetFiber = Number(profileRows[0]?.target_fiber) || 25;

    remaining = {
      calories: (Number(plan.target_calories) || 0) - consumed.calories,
      protein: Math.round((Number(plan.target_protein) || 0) - consumed.protein),
      carbs: Math.round((Number(plan.target_carbs) || 0) - consumed.carbs),
      fat: Math.round((Number(plan.target_fat) || 0) - consumed.fat),
      fiber: Math.round(targetFiber - consumed.fiber),
    };
  }

  return NextResponse.json({
    plan,
    meals: mealRows,
    drinks: drinkRows,
    consumed,
    remaining,
  });
}
