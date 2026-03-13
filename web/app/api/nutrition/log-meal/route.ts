import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "edge";

interface MealItem {
  ingredient_id: string;
  grams: number;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
}

export async function POST(req: NextRequest) {
  const sql = getDb();
  const body = await req.json();
  const {
    date,
    meal_slot,
    preset_meal_id,
    portion_multiplier = 1.0,
    items,
    preset_macros,
  } = body as {
    date: string;
    meal_slot: string;
    source?: string;
    preset_meal_id?: string;
    portion_multiplier?: number;
    items: MealItem[];
    preset_macros?: { calories: number; protein: number; carbs: number; fat: number; fiber: number };
    notes?: string;
  };

  if (!date || !meal_slot) {
    return NextResponse.json(
      { error: "date and meal_slot are required" },
      { status: 400 }
    );
  }

  // Compute totals: use preset_macros if provided (preset items lack per-item macros),
  // otherwise sum from individual items
  let calories = 0,
    protein = 0,
    carbs = 0,
    fat = 0,
    fiber = 0;

  if (preset_macros && preset_meal_id) {
    calories = (Number(preset_macros.calories) || 0) * portion_multiplier;
    protein = (Number(preset_macros.protein) || 0) * portion_multiplier;
    carbs = (Number(preset_macros.carbs) || 0) * portion_multiplier;
    fat = (Number(preset_macros.fat) || 0) * portion_multiplier;
    fiber = (Number(preset_macros.fiber) || 0) * portion_multiplier;
  } else if (Array.isArray(items)) {
    for (const item of items) {
      calories += (Number(item.calories) || 0) * portion_multiplier;
      protein += (Number(item.protein) || 0) * portion_multiplier;
      carbs += (Number(item.carbs) || 0) * portion_multiplier;
      fat += (Number(item.fat) || 0) * portion_multiplier;
      fiber += (Number(item.fiber) || 0) * portion_multiplier;
    }
  }

  // Ensure nutrition_day row exists for this date
  await sql`
    INSERT INTO nutrition_day (date)
    VALUES (${date})
    ON CONFLICT (date) DO NOTHING
  `;

  const result = await sql`
    INSERT INTO meal_log (date, meal_label, preset_id, items, calories, protein, carbs, fat, fiber, multiplier)
    VALUES (
      ${date},
      ${meal_slot},
      ${preset_meal_id ?? null},
      ${JSON.stringify(items)},
      ${Math.round(calories)},
      ${Math.round(protein)},
      ${Math.round(carbs)},
      ${Math.round(fat)},
      ${Math.round(fiber)},
      ${portion_multiplier}
    )
    RETURNING id
  `;

  return NextResponse.json({ id: result[0].id });
}

export async function DELETE(req: NextRequest) {
  const sql = getDb();
  const id = req.nextUrl.searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  await sql`DELETE FROM meal_log WHERE id = ${Number(id)}`;

  return NextResponse.json({ deleted: true });
}
