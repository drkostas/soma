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

  return NextResponse.json({ status: "closed", actual });
}
