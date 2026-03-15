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
  const runEnabled: boolean = plan?.run_enabled ?? true;
  const selectedWorkouts: string[] = plan?.selected_workouts ?? [];
  let gymCalories = 0;

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

    // ── Adjust targets based on activity selections ──
    const baseRunCal = Number(plan.exercise_calories) || 0;
    const runCal = runEnabled ? baseRunCal : 0;

    if (selectedWorkouts.length > 0) {
      const gymRows = await sql`
        WITH ranked AS (
          SELECT hevy_title, calories,
                 ROW_NUMBER() OVER (PARTITION BY hevy_title ORDER BY workout_date DESC) as rn
          FROM workout_enrichment
          WHERE hevy_title = ANY(${selectedWorkouts})
            AND calories IS NOT NULL AND calories > 0
        )
        SELECT ROUND(AVG(calories))::int AS avg_cal
        FROM ranked WHERE rn <= 5
      `;
      gymCalories = Number(gymRows[0]?.avg_cal) || 0;
    }

    const activityCalories = runCal + gymCalories;
    const calorieAdjustment = activityCalories - baseRunCal;
    dayTargets.calories = Math.max(0, dayTargets.calories + calorieAdjustment);

    // If no run, shift 10% of carb calories to fat
    if (!runEnabled && dayTargets.carbs > 0) {
      const carbShift = Math.round(dayTargets.carbs * 0.1);
      const fatEquiv = Math.round((carbShift * 4) / 9);
      dayTargets.carbs -= carbShift;
      dayTargets.fat += fatEquiv;
    }

    // ── Step dedup: subtract run steps from step calories when run is ON ──
    const stepCalories = Number(plan.step_calories) || 0;
    const stepGoal = Number(plan.step_goal) || 10000;
    let adjustedStepCalories = stepCalories;
    let runStepEstimate = 0;

    if (runEnabled && plan.exercise_calories) {
      // Estimate run steps: ~1300 steps per km
      const runDistanceRows = await sql`
        SELECT target_distance_km FROM training_plan_day d
        JOIN training_plan p ON d.plan_id = p.id
        WHERE p.status = 'active' AND d.day_date = ${date}
        LIMIT 1
      `;
      const distKm = Number(runDistanceRows[0]?.target_distance_km) || 0;
      runStepEstimate = Math.round(distKm * 1300);

      if (stepGoal > 0 && runStepEstimate > 0) {
        const calPerStep = stepCalories / stepGoal;
        const runStepCal = Math.round(runStepEstimate * calPerStep);
        adjustedStepCalories = Math.max(0, stepCalories - runStepCal);
        // Adjust target calories: remove the double-counted run step calories
        dayTargets.calories = Math.max(0, dayTargets.calories - runStepCal);
      }
    }

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
    runEnabled,
    selectedWorkouts,
    gymCalories,
  });
}
