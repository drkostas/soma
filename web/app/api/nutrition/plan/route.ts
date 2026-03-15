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
  let breakdown: Record<string, unknown> | null = null;

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

    let gymBreakdown: { title: string; calories: number }[] = [];

    if (selectedWorkouts.length > 0) {
      const gymRows = await sql`
        WITH ranked AS (
          SELECT hevy_title, calories,
                 ROW_NUMBER() OVER (PARTITION BY hevy_title ORDER BY workout_date DESC) as rn
          FROM workout_enrichment
          WHERE hevy_title = ANY(${selectedWorkouts})
            AND calories IS NOT NULL AND calories > 0
        )
        SELECT hevy_title, ROUND(AVG(calories))::int AS avg_cal
        FROM ranked WHERE rn <= 5
        GROUP BY hevy_title
      `;
      for (const r of gymRows) {
        const cal = Number(r.avg_cal) || 0;
        gymCalories += cal;
        gymBreakdown.push({ title: r.hevy_title as string, calories: cal });
      }
    }

    // Note: dayTargets.calories will be fully recomputed below from components

    // ── Dynamic step calories: recompute from weight + step formula ──
    const profileRows = await sql`SELECT weight_kg, step_goal FROM nutrition_profile WHERE id = 1`;
    const weightKg = Number(profileRows[0]?.weight_kg) || 79.2;

    let stepGoal = Number(plan.step_goal) || 0;
    if (!stepGoal || stepGoal === 10000) {
      const profileStepGoal = Number(profileRows[0]?.step_goal) || 0;
      if (profileStepGoal && profileStepGoal !== 10000) {
        stepGoal = profileStepGoal;
      } else {
        stepGoal = stepGoal || 10000;
      }
    }
    const expectedSteps = Number(plan.expected_steps) || stepGoal;

    // Recompute step calories from scratch using weight-based formula
    const calPerStep = 0.0005 * weightKg;
    const rawStepCalories = Math.round(expectedSteps * calPerStep);

    let adjustedStepCalories = rawStepCalories;
    let runStepEstimate = 0;
    let runDistanceKm = 0;

    // Fetch run distance for step dedup
    const runDistanceRows = await sql`
      SELECT target_distance_km FROM training_plan_day d
      JOIN training_plan p ON d.plan_id = p.id
      WHERE p.status = 'active' AND d.day_date = ${date}
      LIMIT 1
    `;
    runDistanceKm = Number(runDistanceRows[0]?.target_distance_km) || 0;

    if (runEnabled && runDistanceKm > 0) {
      runStepEstimate = Math.round(runDistanceKm * 1300);
      adjustedStepCalories = Math.round(Math.max(0, expectedSteps - runStepEstimate) * calPerStep);
    }

    // Recompute target from components: BMR + adjustedSteps + runCal + gymCal - deficit
    const baseBmr = Number(plan.tdee_used) - Number(plan.step_calories || 0) - Number(plan.exercise_calories || 0);
    dayTargets.calories = Math.round(baseBmr + adjustedStepCalories + runCal + gymCalories - (Number(plan.deficit_used) || 0));

    // Recompute macros to match adjusted target
    dayTargets.protein = Math.round(weightKg * 2.2);
    dayTargets.fat = Math.round(weightKg * 0.8);
    dayTargets.carbs = Math.round(Math.max(0, (dayTargets.calories - dayTargets.protein * 4 - dayTargets.fat * 9) / 4));

    // If no run, shift 10% of carb calories to fat
    if (!runEnabled && dayTargets.carbs > 0) {
      const carbShift = Math.round(dayTargets.carbs * 0.1);
      const fatEquiv = Math.round((carbShift * 4) / 9);
      dayTargets.carbs -= carbShift;
      dayTargets.fat += fatEquiv;
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

    // ── Build observability breakdown ──
    breakdown = {
      bmr: Math.round(baseBmr),
      stepCalories: adjustedStepCalories,
      stepCaloriesRaw: rawStepCalories,
      stepGoal,
      expectedSteps,
      minSteps: runEnabled ? runStepEstimate : 0,
      runStepEstimate,
      runCalories: runCal,
      runEnabled,
      runDistanceKm,
      gymCalories,
      gymBreakdown,
      selectedWorkouts,
      deficit: Number(plan.deficit_used) || 0,
      totalBurn: 0,
      targetIntake: dayTargets.calories,
      adjustedTargets: {
        calories: dayTargets.calories,
        protein: dayTargets.protein,
        carbs: dayTargets.carbs,
        fat: dayTargets.fat,
        fiber: dayTargets.fiber,
      },
    };
    breakdown.totalBurn = (breakdown.bmr as number) + adjustedStepCalories + runCal + gymCalories;
  }

  // ── 7-day rolling trend ──
  const trendRows = await sql`
    SELECT
      date,
      target_calories,
      actual_calories,
      status
    FROM nutrition_day
    WHERE date >= ${date}::date - interval '6 days'
      AND date <= ${date}::date
    ORDER BY date
  `;

  const trend7d = {
    days: trendRows.map((r: Record<string, unknown>) => ({
      date: r.date,
      target: Number(r.target_calories) || 0,
      actual: Number(r.actual_calories) || 0,
      closed: r.status === "closed",
      delta:
        r.status === "closed"
          ? (Number(r.actual_calories) || 0) - (Number(r.target_calories) || 0)
          : null,
    })),
    totalDelta: trendRows
      .filter((r: Record<string, unknown>) => r.status === "closed")
      .reduce(
        (sum: number, r: Record<string, unknown>) =>
          sum + ((Number(r.actual_calories) || 0) - (Number(r.target_calories) || 0)),
        0,
      ),
    closedDays: trendRows.filter((r: Record<string, unknown>) => r.status === "closed").length,
  };

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
    breakdown,
    trend7d,
  });
}
