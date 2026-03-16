import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function POST(req: NextRequest) {
  const { date, changedSlot } = await req.json();
  const sql = getDb();

  // 1. Get day target
  const planRows = await sql`SELECT target_calories, manual_override FROM nutrition_day WHERE date = ${date}`;
  const plan = planRows[0];
  if (!plan || !Number(plan.target_calories)) return NextResponse.json({ changes: [] });
  const dayTarget = Number(plan.target_calories);

  // 2. Get all meals and drinks
  const mealRows = await sql`SELECT id, meal_slot, items, calories FROM meal_log WHERE date = ${date} ORDER BY logged_at`;
  const drinkRows = await sql`SELECT calories FROM drink_log WHERE date = ${date}`;
  const drinkCal = drinkRows.reduce((s: number, r: any) => s + (Number(r.calories) || 0), 0);

  // 3. Total eaten
  const totalEaten = mealRows.reduce((s: number, m: any) => s + (Number(m.calories) || 0), 0) + drinkCal;
  const remaining = dayTarget - totalEaten;

  // If under or at budget, no adjustment needed
  if (remaining >= 0) return NextResponse.json({ changes: [] });

  let calToRemove = Math.abs(remaining);

  // 4. Get ingredient shrink priorities
  const ingredientRows = await sql`SELECT id, shrink_priority, calories_per_100g FROM ingredients`;
  const ingMap: Record<string, { priority: number; calPer100g: number }> = {};
  for (const r of ingredientRows) {
    ingMap[r.id as string] = {
      priority: Number(r.shrink_priority) || 2,
      calPer100g: Number(r.calories_per_100g) || 0,
    };
  }

  // 5. Collect adjustable items from meals NOT in changedSlot
  type AdjItem = {
    mealId: number;
    slot: string;
    idx: number;
    id: string;
    name: string;
    grams: number;
    calories: number;
    calPerGram: number;
    priority: number;
  };

  const adjustable: AdjItem[] = [];
  for (const meal of mealRows) {
    if (changedSlot && meal.meal_slot === changedSlot) continue;
    const items = meal.items as any[];
    if (!items) continue;
    items.forEach((item: any, idx: number) => {
      const ing = ingMap[item.ingredient_id];
      if (!ing || ing.priority >= 99) return; // never shrink veggies
      const grams = Number(item.grams) || 0;
      if (grams <= 10) return; // too small to shrink
      adjustable.push({
        mealId: Number(meal.id),
        slot: meal.meal_slot as string,
        idx,
        id: item.ingredient_id,
        name: (item.name || item.ingredient_id || "").replace(/_/g, " "),
        grams,
        calories: Number(item.calories) || 0,
        calPerGram: ing.calPer100g / 100,
        priority: ing.priority,
      });
    });
  }

  // Sort by priority (1=carbs first)
  adjustable.sort((a, b) => a.priority - b.priority);

  // 6. Reduce items
  const changes: { slot: string; ingredient: string; from: number; to: number }[] = [];
  const mealUpdates: Record<number, any[]> = {};

  for (const item of adjustable) {
    if (calToRemove <= 0) break;

    // Don't reduce below 20% of original
    const minGrams = Math.round(item.grams * 0.2);
    const maxCutGrams = item.grams - minGrams;
    const maxCutCal = maxCutGrams * item.calPerGram;
    const cutCal = Math.min(calToRemove, maxCutCal);
    const cutGrams = Math.round(cutCal / item.calPerGram);
    if (cutGrams < 3) continue;

    const newGrams = item.grams - cutGrams;
    calToRemove -= cutCal;

    changes.push({ slot: item.slot, ingredient: item.name, from: item.grams, to: newGrams });

    // Clone meal items for update
    if (!mealUpdates[item.mealId]) {
      const meal = mealRows.find((m: any) => Number(m.id) === item.mealId);
      mealUpdates[item.mealId] = JSON.parse(JSON.stringify(meal?.items || []));
    }
    const mItem = mealUpdates[item.mealId][item.idx];
    if (mItem) {
      const ratio = newGrams / item.grams;
      mItem.grams = newGrams;
      if (mItem.cooked_grams) mItem.cooked_grams = Math.round(mItem.cooked_grams * ratio);
      mItem.calories = Math.round((mItem.calories || 0) * ratio);
      mItem.protein = Math.round(((mItem.protein || 0) * ratio) * 10) / 10;
      mItem.carbs = Math.round(((mItem.carbs || 0) * ratio) * 10) / 10;
      mItem.fat = Math.round(((mItem.fat || 0) * ratio) * 10) / 10;
      mItem.fiber = Math.round(((mItem.fiber || 0) * ratio) * 10) / 10;
    }
  }

  // 7. Write updates
  for (const [mealId, items] of Object.entries(mealUpdates)) {
    const cal = items.reduce((s: number, i: any) => s + (Number(i.calories) || 0), 0);
    const p = items.reduce((s: number, i: any) => s + (Number(i.protein) || 0), 0);
    const c = items.reduce((s: number, i: any) => s + (Number(i.carbs) || 0), 0);
    const f = items.reduce((s: number, i: any) => s + (Number(i.fat) || 0), 0);
    const fi = items.reduce((s: number, i: any) => s + (Number(i.fiber) || 0), 0);

    await sql`UPDATE meal_log SET items = ${JSON.stringify(items)}::jsonb,
      calories = ${cal}, protein = ${p}, carbs = ${c}, fat = ${f}, fiber = ${fi}
      WHERE id = ${Number(mealId)}`;
  }

  return NextResponse.json({ changes });
}
