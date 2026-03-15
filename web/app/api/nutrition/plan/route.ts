import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "edge";

/* ── Per-slot distribution fractions ── */
const SLOT_DISTRIBUTION: Record<string, Record<string, number>> = {
  breakfast: { calories: 0.25, protein: 0.25, carbs: 0.25, fat: 0.25, fiber: 0.2 },
  lunch: { calories: 0.3, protein: 0.25, carbs: 0.3, fat: 0.3, fiber: 0.3 },
  dinner: { calories: 0.35, protein: 0.32, carbs: 0.35, fat: 0.35, fiber: 0.35 },
  pre_sleep: { calories: 0.1, protein: 0.18, carbs: 0.1, fat: 0.1, fiber: 0.15 },
};

const ALL_SLOTS = ["breakfast", "lunch", "dinner", "pre_sleep"] as const;
const MACROS = ["calories", "protein", "carbs", "fat", "fiber"] as const;

/**
 * Redistribute remaining daily macros across unfilled meal slots,
 * weighted by each slot's default distribution fraction.
 */
function redistributeRemaining(
  dayTargets: Record<string, number>,
  eatenBySlot: Record<string, Record<string, number>>,
  skippedSlots: string[] = [],
): Record<string, Record<string, number>> {
  const totalEaten: Record<string, number> = {};
  for (const m of MACROS) totalEaten[m] = 0;

  const filledSlots = new Set<string>();
  for (const [slot, vals] of Object.entries(eatenBySlot)) {
    filledSlots.add(slot);
    for (const m of MACROS) totalEaten[m] += vals[m] ?? 0;
  }

  // Treat skipped slots as filled (zero macros) so their budget redistributes
  for (const s of skippedSlots) {
    if (!filledSlots.has(s)) {
      filledSlots.add(s);
    }
  }

  const remaining: Record<string, number> = {};
  for (const m of MACROS) remaining[m] = Math.max(0, dayTargets[m] - totalEaten[m]);

  const unfilled = ALL_SLOTS.filter((s) => !filledSlots.has(s));
  if (unfilled.length === 0) {
    // All slots filled — return actual eaten values (or zeros)
    return Object.fromEntries(
      ALL_SLOTS.map((s) => [
        s,
        eatenBySlot[s] ?? Object.fromEntries(MACROS.map((m) => [m, 0])),
      ]),
    );
  }

  // Distribute remaining across unfilled slots proportional to kcal weight
  const slotWeights: Record<string, number> = {};
  for (const s of unfilled) slotWeights[s] = SLOT_DISTRIBUTION[s].calories;
  const totalWeight = Object.values(slotWeights).reduce((a, b) => a + b, 0) || 1;

  const result: Record<string, Record<string, number>> = {};
  for (const slot of ALL_SLOTS) {
    if (filledSlots.has(slot)) {
      result[slot] = eatenBySlot[slot];
    } else {
      const frac = slotWeights[slot] / totalWeight;
      result[slot] = Object.fromEntries(
        MACROS.map((m) => [m, Math.round(remaining[m] * frac)]),
      );
    }
  }
  return result;
}

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
  const skippedSlots: string[] = plan?.skipped_slots ?? [];

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

  // Compute day targets, remaining, and per-slot budgets
  let remaining: Record<string, number> | null = null;
  let slotBudgets: Record<string, Record<string, number>> | null = null;

  if (plan) {
    // Resolve fiber target (plan column first, fallback to profile)
    let targetFiber = Number(plan.target_fiber) || 0;
    if (!targetFiber) {
      const profileRows = await sql`
        SELECT target_fiber FROM nutrition_profile WHERE id = 1
      `;
      targetFiber = Number(profileRows[0]?.target_fiber) || 25;
    }

    const dayTargets: Record<string, number> = {
      calories: Number(plan.target_calories) || 0,
      protein: Number(plan.target_protein) || 0,
      carbs: Number(plan.target_carbs) || 0,
      fat: Number(plan.target_fat) || 0,
      fiber: targetFiber,
    };

    remaining = {
      calories: dayTargets.calories - consumed.calories,
      protein: Math.round(dayTargets.protein - consumed.protein),
      carbs: Math.round(dayTargets.carbs - consumed.carbs),
      fat: Math.round(dayTargets.fat - consumed.fat),
      fiber: Math.round(dayTargets.fiber - consumed.fiber),
    };

    // Aggregate eaten macros by meal_slot
    const eatenBySlot: Record<string, Record<string, number>> = {};
    for (const m of mealRows) {
      const slot = m.meal_slot as string;
      if (!slot) continue;
      if (!eatenBySlot[slot]) {
        eatenBySlot[slot] = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
      }
      eatenBySlot[slot].calories += Number(m.calories) || 0;
      eatenBySlot[slot].protein += Number(m.protein) || 0;
      eatenBySlot[slot].carbs += Number(m.carbs) || 0;
      eatenBySlot[slot].fat += Number(m.fat) || 0;
      eatenBySlot[slot].fiber += Number(m.fiber) || 0;
    }

    slotBudgets = redistributeRemaining(dayTargets, eatenBySlot, skippedSlots);
  }

  return NextResponse.json({
    plan,
    meals: mealRows,
    drinks: drinkRows,
    consumed,
    remaining,
    slotBudgets,
    skippedSlots,
  });
}
