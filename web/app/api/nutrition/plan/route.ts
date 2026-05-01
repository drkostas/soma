import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { computeMacroTargetsFromContext } from "@/lib/macro-targets";
import type { Mode } from "@/lib/mode-engine";
import type { SlotBudgets } from "@/lib/nutrition-types";

export const runtime = "edge";

const VALID_MODES: readonly Mode[] = [
  "standard", "aggressive", "reverse", "maintenance", "bulk", "injured",
];

/**
 * Per-slot calorie distribution fractions.
 *
 * Only kcal. Protein/carbs/fat/fiber have no scientific basis for per-slot
 * allocation (Schoenfeld & Aragon 2018; Trommelen 2023). See
 * `web/lib/nutrition-types.ts` for the full invariant.
 */
const SLOT_KCAL_DISTRIBUTION: Record<string, number> = {
  breakfast: 0.28,
  lunch: 0.25,
  dinner: 0.37,
  pre_sleep: 0.1,
};

const ALL_SLOTS = ["breakfast", "lunch", "dinner", "pre_sleep"] as const;

/**
 * Redistribute remaining daily kcal across unfilled meal slots, weighted by
 * each slot's default kcal fraction. Non-kcal macros are not allocated.
 */
function redistributeRemaining(
  dayKcalTarget: number,
  eatenKcalBySlot: Record<string, number>,
  skippedSlots: string[] = [],
): SlotBudgets {
  let totalEaten = 0;
  const filledSlots = new Set<string>();
  for (const [slot, kcal] of Object.entries(eatenKcalBySlot)) {
    filledSlots.add(slot);
    totalEaten += kcal;
  }
  for (const s of skippedSlots) filledSlots.add(s);

  const remaining = Math.max(0, dayKcalTarget - totalEaten);
  const unfilled = ALL_SLOTS.filter((s) => !filledSlots.has(s));

  if (unfilled.length === 0) {
    return Object.fromEntries(
      ALL_SLOTS.map((s) => [s, { calories: eatenKcalBySlot[s] ?? 0 }]),
    );
  }

  const slotWeights: Record<string, number> = {};
  for (const s of unfilled) slotWeights[s] = SLOT_KCAL_DISTRIBUTION[s];
  const totalWeight = Object.values(slotWeights).reduce((a, b) => a + b, 0) || 1;

  const result: SlotBudgets = {};
  for (const slot of ALL_SLOTS) {
    if (filledSlots.has(slot)) {
      result[slot] = { calories: Math.round(eatenKcalBySlot[slot] ?? 0) };
    } else {
      const frac = slotWeights[slot] / totalWeight;
      result[slot] = { calories: Math.round(remaining * frac) };
    }
  }
  return result;
}

export async function GET(req: NextRequest) {
  const sql = getDb();
  const date =
    req.nextUrl.searchParams.get("date") ??
    new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

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
  let drinkCalories = 0;
  for (const d of drinkRows) {
    drinkCalories += Number(d.calories) || 0;
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
  let slotBudgets: SlotBudgets | null = null;
  let breakdown: Record<string, unknown> | null = null;

  if (plan) {
    // Resolve fiber target (plan column first, fallback to profile)
    let targetFiber = Number(plan.target_fiber) || 0;
    if (!targetFiber) {
      const fiberRows = await sql`
        SELECT target_fiber FROM nutrition_profile WHERE id = 1
      `;
      targetFiber = Number(fiberRows[0]?.target_fiber) || 25;
    }

    const dayTargets: Record<string, number> = {
      calories: Number(plan.target_calories) || 0,
      protein: Number(plan.target_protein) || 0,
      carbs: Number(plan.target_carbs) || 0,
      fat: Number(plan.target_fat) || 0,
      fiber: targetFiber,
    };

    // ── Adjust targets based on activity selections ──
    const manualOverride: boolean = plan?.manual_override ?? false;

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

    // ── Check for actual completed activities today ──
    let actualRunCalories: number | null = null;
    let actualRunDistKm = 0;
    let actualGymByTitle: Record<string, number> = {};

    try {
      // Actual run calories from Garmin (summary endpoint, running type)
      const runActualRows = await sql`
        SELECT COALESCE(SUM((raw_json->>'calories')::float), 0) AS total_cal,
               COALESCE(SUM((raw_json->>'distance')::float), 0) AS total_dist
        FROM garmin_activity_raw
        WHERE endpoint_name = 'summary'
          AND raw_json->'activityType'->>'typeKey' = 'running'
          AND (raw_json->>'startTimeLocal')::date = ${date}::date
      `;
      const runCal2 = Number(runActualRows[0]?.total_cal) || 0;
      // NB: assign to the outer-scope `actualRunDistKm`, not a new const.
      // Earlier this line was `const actualRunDistKm = ...` which shadowed
      // the outer variable, so `breakdown.runActualDistKm` always rendered
      // 0km in the dashboard even when a real run was completed.
      actualRunDistKm = Math.round((Number(runActualRows[0]?.total_dist) || 0) / 1000 * 10) / 10;
      if (runCal2 > 0) actualRunCalories = Math.round(runCal2);

      // Actual gym calories from workout_enrichment for today
      const gymActualRows = await sql`
        SELECT hevy_title, calories
        FROM workout_enrichment
        WHERE workout_date = ${date}::date
      `;
      for (const r of gymActualRows) {
        if (r.hevy_title) {
          actualGymByTitle[r.hevy_title as string] = Math.round(Number(r.calories) || 0);
        }
      }
    } catch {
      // Graceful — tables may not exist in demo
    }

    // Note: dayTargets.calories will be fully recomputed below from components

    // ── Dynamic step calories: recompute from weight + step formula ──
    const profileRows = await sql`SELECT weight_kg, step_goal, daily_deficit, tdee_estimate, estimated_bf_pct, deficit_mode FROM nutrition_profile WHERE id = 1`;
    let weightKg = Number(profileRows[0]?.weight_kg) || 79.2;

    // Use latest weight from weight_log (more current than profile)
    try {
      const weightRows = await sql`
        SELECT weight_grams / 1000.0 AS weight_kg FROM weight_log
        WHERE weight_grams IS NOT NULL
        ORDER BY date DESC LIMIT 1
      `;
      if (weightRows[0]?.weight_kg) {
        const lw = Number(weightRows[0].weight_kg);
        if (lw > 0) weightKg = lw;
      }
    } catch {}
    const defaultDeficit = profileRows[0]?.daily_deficit != null ? Number(profileRows[0].daily_deficit) : 500;

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

    // Actual steps from Garmin
    let actualSteps: number | null = null;
    try {
      const stepsRow = await sql`
        SELECT total_steps FROM daily_health_summary WHERE date = ${date}
      `;
      if (stepsRow[0]?.total_steps) {
        actualSteps = Number(stepsRow[0].total_steps);
      }
    } catch {}

    // Recompute step calories from scratch using weight-based formula
    const calPerStep = 0.000423 * weightKg; // conservative: ~-50 kcal/day vs Garmin
    const isClosed = plan?.status === "closed";
    const isPast = date < new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const stepsForCalc = (isClosed || isPast) && actualSteps !== null ? actualSteps : expectedSteps;
    const rawStepCalories = Math.round(stepsForCalc * calPerStep);

    let adjustedStepCalories = rawStepCalories;
    let runStepEstimate = 0;
    let runDistanceKm = 0;

    // Fetch run distance for step dedup. Resolution order:
    //   1. Ad-hoc planned run (nutrition_day.planned_run_km) — user-set
    //      via the Today's Activity panel for unplanned/ad-hoc runs.
    //   2. Coach plan (training_plan_day.target_distance_km) — fallback
    //      when no ad-hoc value but an active training plan exists.
    //   3. 0 — no planned run.
    const adhocRunKm = Number(plan?.planned_run_km) || 0;
    if (adhocRunKm > 0) {
      runDistanceKm = adhocRunKm;
    } else {
      const runDistanceRows = await sql`
        SELECT target_distance_km FROM training_plan_day d
        JOIN training_plan p ON d.plan_id = p.id
        WHERE p.status = 'active' AND d.day_date = ${date}
        LIMIT 1
      `;
      runDistanceKm = Number(runDistanceRows[0]?.target_distance_km) || 0;
    }

    if (runEnabled && runDistanceKm > 0) {
      runStepEstimate = Math.round(runDistanceKm * 1300);
      const MIN_NEAT_STEPS = 3000;
      const netSteps = Math.max(MIN_NEAT_STEPS, expectedSteps - runStepEstimate);
      adjustedStepCalories = Math.round(netSteps * calPerStep);
    }

    // Predicted step calories (always from expectedSteps, with run dedup)
    const predictedStepCalories = runEnabled && runDistanceKm > 0
      ? Math.round(Math.max(3000, expectedSteps - runStepEstimate) * calPerStep)
      : Math.round(expectedSteps * calPerStep);

    // Compute run calories — use plan value, or estimate from distance × weight
    let baseRunCal = Number(plan.exercise_calories) || 0;
    if (baseRunCal === 0 && runDistanceKm > 0) {
      baseRunCal = Math.round(runDistanceKm * 1.0 * weightKg);
    }
    const runCal = runEnabled ? baseRunCal : 0;

    // ── Reliable BMR: query most recent full-day from daily_health_summary ──
    let baseBmr = 0;
    try {
      const bmrRows = await sql`
        SELECT bmr_kilocalories FROM daily_health_summary
        WHERE date < ${date}::date AND bmr_kilocalories > 1500
        ORDER BY date DESC LIMIT 1
      `;
      baseBmr = Number(bmrRows[0]?.bmr_kilocalories) || 0;
    } catch {}
    if (baseBmr === 0) {
      baseBmr = Math.round((Number(profileRows[0]?.tdee_estimate) || 2600) * 0.75);
    }

    // Effective calories: actual if completed, predicted if pending
    const effectiveRunCal = runEnabled
      ? (actualRunCalories !== null ? actualRunCalories : runCal)
      : 0;

    let effectiveGymCal = 0;
    const gymBreakdownFinal: { title: string; calories: number; predicted: number; actual: boolean }[] = [];
    for (const workout of selectedWorkouts) {
      const predictedEntry = gymBreakdown.find((g: any) => g.title === workout);
      const predCal = predictedEntry?.calories ?? 0;
      if (actualGymByTitle[workout] !== undefined) {
        effectiveGymCal += actualGymByTitle[workout];
        gymBreakdownFinal.push({ title: workout, calories: actualGymByTitle[workout], predicted: predCal, actual: true });
      } else {
        effectiveGymCal += predCal;
        gymBreakdownFinal.push({ title: workout, calories: predCal, predicted: predCal, actual: false });
      }
    }

    // Use sleep-adjusted deficit from plan JSON if available, otherwise profile default
    // The sync engine sets plan->deficit_used based on sleep quality (0 for severe, halved for moderate)
    const planJsonDeficit = plan?.plan ? Number((plan.plan as any).deficit_used) : null;
    const effectiveDeficit = manualOverride
      ? (plan.deficit_used != null ? Number(plan.deficit_used) : defaultDeficit)
      : (planJsonDeficit != null ? planJsonDeficit : defaultDeficit);
    dayTargets.calories = Math.round(baseBmr + adjustedStepCalories + effectiveRunCal + effectiveGymCal - effectiveDeficit);

    // If manual_override, use stored target instead of computed
    if (manualOverride && Number(plan.target_calories) > 0) {
      dayTargets.calories = Number(plan.target_calories);
    }

    // ── M4 5-band × tier × mode matrix (Nutrition Batch 2 #67) ──
    // Route to the macro-engine matrix when we have BF% context. Falls
    // back to the legacy flat 2.2 / 0.8 formula when BF% is missing so
    // existing users without a tier continue to see their old numbers.
    const bfPct = profileRows[0]?.estimated_bf_pct != null
      ? Number(profileRows[0].estimated_bf_pct) : null;
    const rawMode = String(profileRows[0]?.deficit_mode ?? "standard");
    const mode: Mode = (VALID_MODES as readonly string[]).includes(rawMode)
      ? (rawMode as Mode) : "standard";
    if (bfPct != null) {
      const matrix = computeMacroTargetsFromContext({
        weightKg, bfPct, mode,
        runKcal: effectiveRunCal,
        gymKcal: effectiveGymCal,
        kcalTarget: dayTargets.calories,
        inDeficit: effectiveDeficit > 0,
      });
      dayTargets.protein = matrix.protein;
      dayTargets.fat = matrix.fat;
      dayTargets.carbs = matrix.carbs;
      dayTargets.fiber = matrix.fiber;
    } else {
      // Legacy flat fallback (preserved for users without BF%).
      dayTargets.protein = Math.round(weightKg * 2.2);
      dayTargets.fat = Math.round(weightKg * 0.8);
      dayTargets.carbs = Math.round(Math.max(0, (dayTargets.calories - dayTargets.protein * 4 - dayTargets.fat * 9) / 4));
    }

    // Scale protein+fat down if they exceed calorie budget (extreme deficit days)
    const macroFloorCal = dayTargets.protein * 4 + dayTargets.fat * 9;
    if (macroFloorCal > dayTargets.calories && dayTargets.calories > 0) {
      const scale = dayTargets.calories / macroFloorCal;
      dayTargets.protein = Math.round(dayTargets.protein * scale);
      dayTargets.fat = Math.round(dayTargets.fat * scale);
      dayTargets.carbs = 0;
    }

    // If no run, shift 10% of carb calories to fat
    if (!runEnabled && dayTargets.carbs > 0) {
      const carbShift = Math.round(dayTargets.carbs * 0.1);
      const fatEquiv = Math.round((carbShift * 4) / 9);
      dayTargets.carbs -= carbShift;
      dayTargets.fat += fatEquiv;
    }

    // ── Alcohol offset: reduce food macro targets by drink calories ──
    if (drinkCalories > 0) {
      dayTargets.calories = Math.max(0, dayTargets.calories - drinkCalories);
      // Reduce carbs first (alcohol inhibits carb oxidation), then fat
      const carbGramsToRemove = Math.min(Math.round(drinkCalories / 4), dayTargets.carbs);
      dayTargets.carbs -= carbGramsToRemove;
      const remainingDrinkCal = drinkCalories - carbGramsToRemove * 4;
      if (remainingDrinkCal > 0) {
        const fatGramsToRemove = Math.min(Math.round(remainingDrinkCal / 9), dayTargets.fat);
        dayTargets.fat -= fatGramsToRemove;
      }
    }

    remaining = {
      calories: dayTargets.calories - consumed.calories,
      protein: Math.round(dayTargets.protein - consumed.protein),
      carbs: Math.round(dayTargets.carbs - consumed.carbs),
      fat: Math.round(dayTargets.fat - consumed.fat),
      fiber: Math.round(dayTargets.fiber - consumed.fiber),
    };

    // Aggregate eaten kcal by meal_slot — only kcal is budgeted per slot.
    const eatenKcalBySlot: Record<string, number> = {};
    for (const m of mealRows) {
      const slot = m.meal_slot as string;
      if (!slot) continue;
      eatenKcalBySlot[slot] = (eatenKcalBySlot[slot] ?? 0) + (Number(m.calories) || 0);
    }

    slotBudgets = redistributeRemaining(dayTargets.calories, eatenKcalBySlot, skippedSlots);

    // ── Build observability breakdown ──
    breakdown = {
      bmr: Math.round(baseBmr),
      stepCalories: adjustedStepCalories,
      stepCaloriesPredicted: predictedStepCalories,
      stepCaloriesRaw: rawStepCalories,
      stepGoal,
      expectedSteps,
      actualSteps,
      minSteps: runEnabled ? runStepEstimate : 0,
      runStepEstimate,
      runCalories: effectiveRunCal,
      runActual: actualRunCalories !== null,
      runActualDistKm: actualRunDistKm,
      runPredicted: runCal,
      runEnabled,
      runDistanceKm,
      gymCalories: effectiveGymCal,
      gymBreakdown: gymBreakdownFinal,
      selectedWorkouts,
      drinkCalories,
      deficit: effectiveDeficit,
      totalBurn: Math.round(baseBmr + adjustedStepCalories + effectiveRunCal + effectiveGymCal),
      targetIntake: dayTargets.calories,
      manualOverride,
      adjustedTargets: {
        calories: dayTargets.calories,
        protein: dayTargets.protein,
        carbs: dayTargets.carbs,
        fat: dayTargets.fat,
        fiber: dayTargets.fiber,
      },
      weightKg,
    };

    // ── Write-back: sync computed values to DB so stored matches dynamic ──
    // Only for current day, non-manual days, when values differ
    const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    if (date === todayStr && !manualOverride && breakdown) {
      const computedTarget = dayTargets.calories;
      const storedTarget = Number(plan.target_calories) || 0;
      if (Math.abs(computedTarget - storedTarget) > 10 || !plan.target_calories) {
        try {
          await sql`
            UPDATE nutrition_day SET
              target_calories = ${computedTarget},
              target_protein = ${dayTargets.protein},
              target_carbs = ${dayTargets.carbs},
              target_fat = ${dayTargets.fat},
              deficit_used = ${effectiveDeficit},
              tdee_used = ${Math.round(baseBmr + adjustedStepCalories + effectiveRunCal + effectiveGymCal)}
            WHERE date = ${date} AND manual_override = FALSE
          `;
        } catch {}
      }
    }
  }

  // ── 7-day rolling trend ──
  const trendRows = await sql`
    SELECT
      date::text AS date,
      target_calories,
      actual_calories,
      status,
      manual_override,
      deficit_used
    FROM nutrition_day
    WHERE date >= ${date}::date - interval '6 days'
      AND date <= ${date}::date
    ORDER BY date
  `;

  // Goal deficit from profile (the user's real target, e.g. 800/day)
  let goalDeficit = 800;
  try {
    const profRows = await sql`SELECT daily_deficit FROM nutrition_profile WHERE id = 1`;
    goalDeficit = profRows[0]?.daily_deficit != null ? Number(profRows[0].daily_deficit) : 800;
  } catch {}

  // Compute burn per day from stored plan data (consistent with budget card model)
  const computeBurn = (r: Record<string, unknown>, isCurrentDay: boolean) => {
    if (isCurrentDay && breakdown) return Number((breakdown as any).totalBurn) || 0;
    // Reconstruct from stored values: burn = target + deficit
    const target = Number(r.target_calories) || 0;
    const defUsed = Number(r.deficit_used) || goalDeficit;
    return target + defUsed;
  };

  const trend7d = {
    goalDeficit,
    days: trendRows.map((r: Record<string, unknown>) => {
      const isCurrentDay = String(r.date) === date;
      const ate = isCurrentDay ? consumed.calories : (Number(r.actual_calories) || 0);
      const burn = Math.round(computeBurn(r, isCurrentDay));
      const deficit = ate - burn; // negative = deficit (good), positive = surplus (bad)
      return {
        date: r.date,
        ate,
        burn,
        deficit,
        closed: r.status === "closed",
        isToday: isCurrentDay,
      };
    }),
    // Cumulative deficit: sum of (ate - burn) for closed days only
    totalDeficit: trendRows
      .filter((r: Record<string, unknown>) => r.status === "closed")
      .reduce((sum: number, r: Record<string, unknown>) => {
        const ate = Number(r.actual_calories) || 0;
        const burn = Math.round(computeBurn(r, false));
        return sum + (ate - burn);
      }, 0),
    closedDays: trendRows.filter((r: Record<string, unknown>) => r.status === "closed").length,
    goalExpectedDeficit: trendRows
      .filter((r: Record<string, unknown>) => r.status === "closed")
      .length * goalDeficit,
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
