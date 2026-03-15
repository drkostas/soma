import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "edge";

export async function GET() {
  const sql = getDb();

  const [presets, ingredients] = await Promise.all([
    sql`SELECT id, name, items, tags, meal_slot, total_calories, total_protein,
               total_carbs, total_fat, total_fiber, is_system, use_count, created_at
        FROM preset_meals ORDER BY name`,
    sql`SELECT * FROM ingredients ORDER BY category, name`,
  ]);

  return NextResponse.json({ presets, ingredients });
}

export async function POST(req: NextRequest) {
  const sql = getDb();
  const { name, items, slot, totals } = (await req.json()) as {
    name: string;
    items: { ingredient_id: string; grams: number }[];
    slot: string;
    totals: { calories: number; protein: number; carbs: number; fat: number; fiber: number };
  };

  if (!name || !items?.length) {
    return NextResponse.json({ error: "name and items are required" }, { status: 400 });
  }

  const itemsBlob = {
    items,
    calories: totals.calories,
    protein: totals.protein,
    carbs: totals.carbs,
    fat: totals.fat,
    fiber: totals.fiber,
  };

  const tags = slot ? [slot] : [];
  const presetId = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${Date.now()}`;

  const result = await sql`
    INSERT INTO preset_meals (id, name, items, tags, meal_slot, total_calories, total_protein, total_carbs, total_fat, total_fiber, is_system)
    VALUES (
      ${presetId}, ${name}, ${JSON.stringify(itemsBlob)}, ${tags}, ${slot},
      ${Math.round(totals.calories)}, ${Math.round(totals.protein)},
      ${Math.round(totals.carbs)}, ${Math.round(totals.fat)},
      ${Math.round(totals.fiber)}, false
    )
    RETURNING id
  `;

  return NextResponse.json({ id: result[0].id });
}
