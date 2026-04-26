"use client";

import React, { useState, useCallback, useEffect } from "react";
import { AlertTriangle, Lock, Moon, Footprints, Dumbbell, ChevronLeft, ChevronRight, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { MealCard } from "@/components/meal-card";
import { DrinkLogger } from "@/components/drink-logger";
import { ActivitySelector } from "@/components/activity-selector";
import { PrepSummary } from "@/components/prep-summary";
import type { SlotBudgets } from "@/lib/nutrition-types";

// ── Types ─────────────────────────────────────────────────────

interface NutritionPlan {
  date: string;
  plan: Record<string, any> | null;
  target_calories: number | null;
  target_protein: number | null;
  target_carbs: number | null;
  target_fat: number | null;
  target_fiber: number | null;
  tdee_used: number | null;
  exercise_calories: number | null;
  step_calories: number | null;
  deficit_used: number | null;
  adjustment_reason: string | null;
  sleep_quality_score: number | null;
  training_day_type: string | null;
  planned_workouts: any | null;
  step_goal: number | null;
  is_refeed: boolean;
  is_diet_break: boolean;
  status: string;
}

interface Meal {
  id: number;
  date: string;
  meal_slot: string;
  source: string | null;
  preset_meal_id: string | null;
  preset_name: string | null;
  preset_tags: string[] | null;
  portion_multiplier: number;
  items: any;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  notes: string | null;
  weigh_method: string | null;
  logged_at: string;
}

interface Drink {
  id: number;
  date: string;
  drink_type: string;
  name: string;
  quantity: number;
  quantity_ml: number;
  calories: number;
  carbs: number;
  alcohol_grams: number;
  fat_oxidation_pause_hours: number;
  logged_at: string;
}

interface Preset {
  id: string;
  name: string;
  items: any;
  tags: string[] | null;
}

interface TrainingDay {
  run_type: string | null;
  run_title: string | null;
  target_distance_km: number | null;
  target_duration_min: number | null;
  load_level: string | null;
  gym_workout: string | null;
  plan_name: string | null;
}

interface HealthSummary {
  total_steps: number | null;
  bmr_kilocalories: number | null;
  active_kilocalories: number | null;
  sleep_time_seconds: number | null;
}

interface SleepDetail {
  total_sleep_seconds: number | null;
  deep_sleep_seconds: number | null;
  sleep_score: number | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
interface NutritionDashboardProps {
  date: string;
  plan: any;
  meals: any[];
  drinks: any[];
  presets: any[];
  ingredients: any[];
  training: any;
  health: any;
  sleep: any;
}

// ── Helpers ───────────────────────────────────────────────────

const MEAL_SLOTS = ["breakfast", "lunch", "dinner", "pre_sleep"] as const;

/**
 * MacroBar — bounds-aware macro progress bar.
 *
 * Visual convention:
 *   - Floor marker (left-pointing wedge, teal): "eat at least here". When
 *     `current < floor` the text below the bar shows a muted "low" hint;
 *     fill stays macro color (we don't penalize mid-day under-eating with
 *     amber because the user is still filling up).
 *   - Ceiling marker (right-pointing wedge, warm): "don't cross this".
 *     When `current > ceiling` the fill and text turn amber.
 *   - If neither floor nor ceiling is passed, the bar renders as a pure
 *     progress fill with no markers.
 *
 * Per-macro usage:
 *   - Protein: floor = matrix target, ceiling = null (no scientific cap).
 *   - Fat: floor = target, ceiling = null.
 *   - Carbs: floor = target, ceiling = null (kcal-implicit upper).
 *   - Fiber: floor = target, ceiling = 60g (phytate cap, V2 §2.4).
 */
function MacroBar({
  label,
  current,
  target,
  color,
  floor,
  ceiling,
}: {
  label: string;
  current: number;
  target: number;
  color: string;
  floor?: number | null;
  ceiling?: number | null;
}) {
  // Axis scale: leave room past the highest anchor so both markers show.
  const axisAnchors = [
    target * 1.15,
    floor != null ? floor * 1.15 : 0,
    ceiling != null ? ceiling * 1.05 : 0,
    current * 1.05,
    target + 1,
  ];
  const maxVal = Math.max(...axisAnchors);
  const fillPct = maxVal > 0 ? Math.min(100, (current / maxVal) * 100) : 0;
  const floorPct = floor != null && maxVal > 0
    ? Math.min(100, (floor / maxVal) * 100)
    : null;
  const ceilingPct = ceiling != null && maxVal > 0
    ? Math.min(100, (ceiling / maxVal) * 100)
    : null;

  const overCeiling = ceiling != null && current > ceiling;
  const underFloor = floor != null && current < floor;

  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-xs lg:text-sm text-muted-foreground">
        <span>{label}</span>
        <span className={overCeiling ? "text-amber-500 font-medium" : ""}>
          {Math.round(current)}/{Math.round(target)}g
          {underFloor && (
            <span className="ml-1 text-[10px] text-muted-foreground/70">
              (−{Math.round(floor! - current)} to floor)
            </span>
          )}
        </span>
      </div>
      <div className="relative h-2 rounded-full overflow-hidden bg-muted">
        {/* Ceiling danger zone — muted warm tint past the ceiling */}
        {ceilingPct !== null && (
          <div
            className="absolute right-0 top-0 h-full bg-amber-500/10"
            style={{ width: `${100 - ceilingPct}%` }}
          />
        )}
        {/* Fill */}
        <div
          className={`absolute left-0 top-0 h-full rounded-full transition-all ${overCeiling ? "bg-amber-500" : color}`}
          style={{ width: `${fillPct}%` }}
        />
        {/* Floor marker (teal) — "eat at least here" */}
        {floorPct !== null && floor! > 0 && (
          <div
            className="absolute top-0 h-full w-[2px] bg-teal-500/70"
            style={{ left: `calc(${Math.min(floorPct, 99.5)}% - 1px)` }}
            title={`Floor: ${Math.round(floor!)}g — aim to reach this`}
          />
        )}
        {/* Ceiling marker (warm) — "don't cross this" */}
        {ceilingPct !== null && ceiling! > 0 && (
          <div
            className="absolute top-0 h-full w-[2px] bg-amber-500"
            style={{ left: `calc(${Math.min(ceilingPct, 99.5)}% - 1px)` }}
            title={`Ceiling: ${Math.round(ceiling!)}g — do not exceed`}
          />
        )}
      </div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────

export function NutritionDashboard({
  date,
  plan: initialPlan,
  meals: initialMeals,
  drinks: initialDrinks,
  presets: initialPresets,
  ingredients,
  training,
  health,
  sleep,
}: NutritionDashboardProps) {
  const [plan, setPlan] = useState(initialPlan);
  const [meals, setMeals] = useState<Meal[]>(initialMeals);
  const [drinks, setDrinks] = useState<Drink[]>(initialDrinks);
  const [presets, setPresets] = useState(initialPresets);
  const [closing, setClosing] = useState(false);
  const [copying, setCopying] = useState(false);
  // workoutEnabled removed — activity toggles now flow through API via ActivitySelector
  const [runEnabled, setRunEnabled] = useState<boolean>(initialPlan?.run_enabled ?? true);
  const [selectedWorkouts, setSelectedWorkouts] = useState<string[]>(initialPlan?.selected_workouts ?? []);
  const [gymCalories, setGymCalories] = useState<number>(0);
  const [skippedSlots, setSkippedSlots] = useState<string[]>(initialPlan?.skipped_slots ?? []);
  const [slotBudgets, setSlotBudgets] = useState<SlotBudgets | null>(null);
  const [budgetExpanded, setBudgetExpanded] = useState(false);
  const [breakdown, setBreakdown] = useState<any>(null);
  const [trend7d, setTrend7d] = useState<any>(null);
  const [dataReady, setDataReady] = useState(false);
  const [rebalanceToast, setRebalanceToast] = useState<string | null>(null);

  const isClosed = plan?.status === "closed";

  const refreshData = useCallback(async () => {
    try {
      const [planRes, presetsRes] = await Promise.all([
        fetch(`/api/nutrition/plan?date=${date}`),
        fetch("/api/nutrition/presets"),
      ]);
      if (planRes.ok) {
        const data = await planRes.json();
        if (data.plan) setPlan(data.plan);
        if (data.meals) setMeals(data.meals);
        if (data.drinks) setDrinks(data.drinks);
        setRunEnabled(data.runEnabled ?? true);
        setSelectedWorkouts(data.selectedWorkouts ?? []);
        setGymCalories(data.gymCalories ?? 0);
        setSkippedSlots(data.skippedSlots ?? []);
        if (data.slotBudgets) setSlotBudgets(data.slotBudgets);
        if (data.breakdown) setBreakdown(data.breakdown);
        if (data.trend7d) setTrend7d(data.trend7d);
      }
      if (presetsRes.ok) {
        const presetsData = await presetsRes.json();
        if (presetsData.presets) setPresets(presetsData.presets);
      }
      setDataReady(true);
    } catch {
      setDataReady(true);
    }
  }, [date]);

  const rebalanceMeals = useCallback(async (changedSlot?: string) => {
    try {
      const res = await fetch("/api/nutrition/rebalance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, changedSlot, lockedSlots: Array.from(lockedSlots) }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.changes && data.changes.length > 0) {
        const msg = data.changes
          .map((c: any) => `${c.ingredient} ${c.from}g \u2192 ${c.to}g`)
          .join(", ");
        setRebalanceToast(msg);
        setTimeout(() => setRebalanceToast(null), 5000);
        await refreshData();
      }
    } catch {}
  }, [date, refreshData]);

  const handleMealChanged = useCallback(async (changedSlot?: string) => {
    await refreshData();
    await rebalanceMeals(changedSlot);
  }, [refreshData, rebalanceMeals]);

  // Load breakdown + trend data on mount
  useEffect(() => {
    refreshData();
  }, [refreshData]);

  // Locked slots (won't be rebalanced) — persisted in localStorage per date
  const [lockedSlots, setLockedSlots] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const stored = localStorage.getItem(`locked-slots-${date}`);
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });
  const handleLockToggle = useCallback((slot: string) => {
    setLockedSlots(prev => {
      const next = new Set(prev);
      if (next.has(slot)) next.delete(slot);
      else next.add(slot);
      try { localStorage.setItem(`locked-slots-${date}`, JSON.stringify([...next])); } catch {}
      return next;
    });
  }, [date]);

  // Live preview totals from compose view
  const [previewTotals, setPreviewTotals] = useState<Record<string, { calories: number; protein: number; carbs: number; fat: number; fiber: number }>>({});

  const handleTotalsPreview = useCallback((slot: string, totals: { calories: number; protein: number; carbs: number; fat: number; fiber: number } | null) => {
    setPreviewTotals(prev => {
      if (totals === null) {
        const next = { ...prev };
        delete next[slot];
        return next;
      }
      return { ...prev, [slot]: totals };
    });
  }, []);

  // Sum preview totals from any active compose views
  const previewCal = Object.values(previewTotals).reduce((s, t) => s + t.calories, 0);
  const previewProtein = Object.values(previewTotals).reduce((s, t) => s + t.protein, 0);
  const previewCarbs = Object.values(previewTotals).reduce((s, t) => s + t.carbs, 0);
  const previewFat = Object.values(previewTotals).reduce((s, t) => s + t.fat, 0);
  const previewFiber = Object.values(previewTotals).reduce((s, t) => s + t.fiber, 0);

  // Compute consumed totals (logged meals + live preview)
  const consumedCal =
    meals.reduce((s, m) => s + Number(m.calories || 0), 0) +
    drinks.reduce((s, d) => s + Number(d.calories || 0), 0) +
    previewCal;
  const consumedProtein = meals.reduce(
    (s, m) => s + Number(m.protein || 0),
    0
  ) + previewProtein;
  const consumedCarbs =
    meals.reduce((s, m) => s + Number(m.carbs || 0), 0) +
    drinks.reduce((s, d) => s + Number(d.carbs || 0), 0) +
    previewCarbs;
  const consumedFat = meals.reduce((s, m) => s + Number(m.fat || 0), 0) + previewFat;
  const consumedFiber = meals.reduce((s, m) => s + Number(m.fiber || 0), 0) + previewFiber;

  // Use breakdown-adjusted targets (computed by plan API accounting for run/gym toggles)
  // Fall back to raw plan values for initial render before breakdown loads
  const targetCal = breakdown?.adjustedTargets?.calories ?? (Number(plan?.target_calories) || 0);
  const targetProtein = breakdown?.adjustedTargets?.protein ?? (Number(plan?.target_protein) || 0);
  const targetCarbs = breakdown?.adjustedTargets?.carbs ?? (Number(plan?.target_carbs) || 0);
  const targetFat = breakdown?.adjustedTargets?.fat ?? (Number(plan?.target_fat) || 0);
  const targetFiber = breakdown?.adjustedTargets?.fiber ?? (Number(plan?.target_fiber) || 0);
  const remainingCal = targetCal - consumedCal;

  const adjustmentReason =
    plan?.adjustment_reason ??
    (plan?.plan ? (plan.plan as Record<string, any>).adjustment_reason : null);

  const trainingDistanceKm = Number(training?.target_distance_km) || 0;
  const trainingDurationMin = Number(training?.target_duration_min) || 0;
  const showDuringWorkout = trainingDurationMin > 60 || trainingDistanceKm > 10;

  const slots = showDuringWorkout
    ? [...MEAL_SLOTS, "during_workout" as const]
    : [...MEAL_SLOTS];

  // Unlock manual override handler
  const handleUnlock = async () => {
    try {
      const res = await fetch("/api/nutrition/activity-select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, manual_override: false }),
      });
      if (!res.ok) {
        console.error("Unlock failed:", res.status);
        return;
      }
      await refreshData();
    } catch (err) {
      console.error("Unlock error:", err);
    }
  };

  // Close day handler
  const handleCloseDay = async () => {
    setClosing(true);
    try {
      const res = await fetch("/api/nutrition/close-day", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date }),
      });
      if (res.ok) {
        await refreshData();
      }
    } finally {
      setClosing(false);
    }
  };

  // Format sleep hours
  const sleepHours = sleep?.total_sleep_seconds
    ? (Number(sleep.total_sleep_seconds) / 3600).toFixed(1)
    : null;

  return (
    <div className="space-y-4 lg:grid lg:grid-cols-[420px_1fr] lg:gap-8 lg:space-y-0 lg:max-w-5xl lg:mx-auto">
      {/* ── LEFT COLUMN: summary & controls (sticky on desktop) ── */}
      <div className="space-y-4 lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto lg:scrollbar-none">
        {/* Date header with navigation */}
        <div className="flex items-center justify-between">
          <a href={`/nutrition?date=${(() => { const d = new Date(date + "T12:00:00"); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); })()}`}>
            <Button variant="ghost" size="icon"><ChevronLeft className="h-4 w-4" /></Button>
          </a>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">
              {new Date(date + "T12:00:00").toLocaleDateString("en-US", {
                weekday: "long",
                month: "short",
                day: "numeric",
              })}
            </h1>
            {isClosed && (
              <Badge variant="secondary" className="gap-1">
                <Lock className="h-3 w-3" />
                Closed
              </Badge>
            )}
            {isClosed && (
              <button
                onClick={async () => {
                  await fetch("/api/nutrition/reopen-day", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ date }),
                  });
                  await refreshData();
                }}
                className="text-[10px] text-muted-foreground hover:text-foreground underline ml-1"
              >
                reopen
              </button>
            )}
            {breakdown?.manualOverride && !isClosed && (
              <Badge variant="secondary" className="gap-1 text-amber-500 border-amber-500/30">
                <Lock className="h-3 w-3" />
                Offset Plan
                <button onClick={handleUnlock} className="ml-1 hover:text-foreground">
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            )}
          </div>
          <a href={`/nutrition?date=${(() => { const d = new Date(date + "T12:00:00"); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); })()}`}>
            <Button variant="ghost" size="icon"><ChevronRight className="h-4 w-4" /></Button>
          </a>
        </div>

        {/* Sleep adjustment banner — disabled, sleep adjustments are off */}

        {/* Budget card */}
        {targetCal > 0 ? (
          <Card>
            <CardContent className="pt-4 space-y-3">
              {/* Main calories display */}
              <div className="text-center">
                {!dataReady ? (
                  <div className="h-12 flex items-center justify-center">
                    <div className="text-sm text-muted-foreground animate-pulse">calculating...</div>
                  </div>
                ) : (
                  <>
                    <div className={`text-4xl lg:text-5xl font-bold tabular-nums ${remainingCal < 0 ? "text-rose-500" : ""}`}>
                      {remainingCal < 0 ? `+${Math.abs(Math.round(remainingCal))}` : Math.round(remainingCal)}
                    </div>
                    <div className="text-xs lg:text-sm text-muted-foreground">
                      {remainingCal < 0 ? "over goal" : "to goal"}
                    </div>
                  </>
                )}
              </div>

              {/* Burn-based bar with goal marker */}
              {dataReady && breakdown && (() => {
                const totalBurn = breakdown.totalBurn || 0;
                const goalIntake = breakdown.targetIntake || 0;
                const deficit = breakdown.deficit || 0;
                const eatPct = totalBurn > 0 ? Math.min(100, (consumedCal / totalBurn) * 100) : 0;
                const goalPct = totalBurn > 0 ? Math.min(100, (goalIntake / totalBurn) * 100) : 0;
                const currentDeficit = consumedCal - totalBurn;
                return (
                  <div className="space-y-1">
                    {/* Bar with 3 hover zones */}
                    <div className="relative h-3 rounded-full overflow-hidden bg-muted">
                      {/* Ceiling danger zone (right of goal) — muted warm */}
                      <div
                        className="absolute right-0 top-0 h-full bg-amber-500/10"
                        style={{ width: `${100 - goalPct}%` }}
                        title={`Deficit goal: −${deficit} kcal\nTotal burn: ${totalBurn} kcal`}
                      />
                      {/* Zone 2: Room to goal (between eaten and goal) — transparent hover target */}
                      {eatPct < goalPct && (
                        <div
                          className="absolute top-0 h-full"
                          style={{ left: `${eatPct}%`, width: `${goalPct - eatPct}%` }}
                          title={`${Math.round(goalIntake - consumedCal)} kcal to goal\nGoal: eat ≤ ${goalIntake} kcal`}
                        />
                      )}
                      {/* Zone 1: Eaten fill */}
                      <div
                        className={`absolute left-0 top-0 h-full rounded-full transition-all ${consumedCal > goalIntake ? "bg-amber-500" : "bg-primary"}`}
                        style={{ width: `${eatPct}%` }}
                        title={`Eaten: ${Math.round(consumedCal)} kcal`}
                      />
                      {/* Ceiling marker (warm) — 'don't cross' the kcal
                          goal. Clamped to stay inside overflow-hidden when
                          goalPct hits 100% (e.g. deficit=0 days). */}
                      <div
                        className="absolute top-0 h-full w-[2px] bg-amber-500"
                        style={{ left: `calc(${Math.min(goalPct, 99.5)}% - 1px)` }}
                        title={`Ceiling: eat ≤ ${goalIntake} kcal${deficit > 0 ? ` (−${deficit} deficit)` : " (maintenance)"}`}
                      />
                    </div>
                    {/* Labels under bar */}
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>{Math.round(consumedCal)} eaten</span>
                      <span>{goalIntake} goal{deficit > 0 && <span className="text-muted-foreground/50"> (&minus;{deficit})</span>}</span>
                      <span>{totalBurn} burn</span>
                    </div>
                    {/* Current deficit */}
                    <div className="text-xs text-center">
                      <span className={currentDeficit < 0 ? "text-green-500" : "text-rose-500"}>{currentDeficit > 0 ? "+" : ""}{Math.round(currentDeficit)} current deficit</span>
                    </div>
                  </div>
                );
              })()}

              {/* Expand/collapse toggle — hidden on desktop (details always shown) */}
              <button
                className="w-full text-[10px] text-muted-foreground text-center hover:text-foreground transition-colors lg:hidden"
                onClick={() => setBudgetExpanded(!budgetExpanded)}
              >
                {budgetExpanded ? "\u25B2 hide details" : "\u25BC show details"}
              </button>

              {/* Expanded breakdown — always visible on desktop, toggle on mobile */}
              <div className={`${budgetExpanded ? "" : "hidden"} lg:block`}>
                {breakdown && (
                  <div className="space-y-3 border-t pt-3">
                    {/* Calorie equation breakdown */}
                    <div className="space-y-1">
                      <div className="text-[10px] lg:text-xs font-medium text-muted-foreground uppercase tracking-wider">Calorie Breakdown</div>
                      <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 text-xs">
                        <span className="text-muted-foreground">Passive burn (BMR)</span>
                        <span className="tabular-nums text-right">{breakdown.bmr}</span>

                        <span className="text-muted-foreground">
                          Steps ({breakdown.actualSteps !== null && breakdown.actualSteps !== undefined
                            ? `${breakdown.actualSteps.toLocaleString()} actual`
                            : `${(breakdown.expectedSteps || breakdown.stepGoal || 10000).toLocaleString()} expected`})
                          {breakdown.runStepEstimate > 0 && (
                            <span className="text-[10px]"> excl. ~{breakdown.runStepEstimate} run steps</span>
                          )}
                        </span>
                        <span className="tabular-nums text-right text-green-500">
                          +{breakdown.stepCalories}
                          {breakdown.stepCaloriesPredicted !== undefined && breakdown.stepCalories !== breakdown.stepCaloriesPredicted && (
                            <span className="text-muted-foreground/50 text-[9px] ml-1">(~{breakdown.stepCaloriesPredicted})</span>
                          )}
                        </span>

                        {breakdown.runCalories > 0 && (
                          <>
                            <span className="text-muted-foreground">
                              Run ({breakdown.runActual && breakdown.runActualDistKm ? breakdown.runActualDistKm : breakdown.runDistanceKm}km)
                              <span className={`ml-1 text-[9px] ${breakdown.runActual ? "text-green-500" : "text-amber-500"}`}>
                                {breakdown.runActual ? "actual" : "predicted"}
                              </span>
                            </span>
                            <span className="tabular-nums text-right text-green-500">
                              +{breakdown.runCalories}
                              {breakdown.runActual && breakdown.runPredicted > 0 && breakdown.runCalories !== breakdown.runPredicted && (
                                <span className="text-muted-foreground/50 text-[9px] ml-1">(~{breakdown.runPredicted})</span>
                              )}
                            </span>
                          </>
                        )}

                        {breakdown.gymBreakdown && breakdown.gymBreakdown.length > 0 ? (
                          breakdown.gymBreakdown.map((w: any) => (
                            <React.Fragment key={w.title}>
                              <span className="text-muted-foreground">
                                Gym: {w.title}
                                <span className={`ml-1 text-[9px] ${w.actual ? "text-green-500" : "text-amber-500"}`}>
                                  {w.actual ? "actual" : "predicted"}
                                </span>
                              </span>
                              <span className="tabular-nums text-right text-green-500">
                                +{w.calories}
                                {w.actual && w.predicted > 0 && w.calories !== w.predicted && (
                                  <span className="text-muted-foreground/50 text-[9px] ml-1">(~{w.predicted})</span>
                                )}
                              </span>
                            </React.Fragment>
                          ))
                        ) : breakdown.gymCalories > 0 ? (
                          <>
                            <span className="text-muted-foreground">
                              Gym ({breakdown.selectedWorkouts?.join(", ")})
                            </span>
                            <span className="tabular-nums text-right text-green-500">+{breakdown.gymCalories}</span>
                          </>
                        ) : null}

                        <span className="text-muted-foreground font-medium border-t pt-1">Total burn</span>
                        <span className="tabular-nums text-right font-bold border-t pt-1">{breakdown.totalBurn}</span>
                      </div>
                    </div>

                    {/* Per-slot kcal pacing. P/C/F/Fi are intentionally not
                        split across slots — no scientific basis for per-slot
                        non-kcal allocation. See lib/nutrition-types.ts. */}
                    {slotBudgets && (
                      <div className="space-y-1">
                        <div className="text-[10px] lg:text-xs font-medium text-muted-foreground uppercase tracking-wider">Per-Meal kcal Pacing</div>
                        {skippedSlots.length >= 4 ? (
                          <div className="text-xs text-muted-foreground text-center py-2">Fasting day — all meals skipped</div>
                        ) : (
                          <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-xs">
                            <span className="text-muted-foreground text-[10px]">Slot</span>
                            <span className="text-muted-foreground text-[10px] text-right">kcal</span>
                            {Object.entries(slotBudgets).map(([slot, macros]) => (
                              <React.Fragment key={slot}>
                                <span className={skippedSlots.includes(slot) ? "text-muted-foreground/50 line-through" : ""}>
                                  {slot.replace("_", "-")}
                                </span>
                                <span className="tabular-nums text-right">{Math.round(macros.calories)}</span>
                              </React.Fragment>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* 7-day trend table */}
                    {trend7d && trend7d.days.length > 0 && (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <div className="text-[10px] lg:text-xs font-medium text-muted-foreground uppercase tracking-wider">7-Day Trend</div>
                          <div className="text-[9px] text-muted-foreground/60">goal: &minus;{trend7d.goalDeficit}/day</div>
                        </div>
                        <div className="grid grid-cols-[1fr_auto_auto] sm:grid-cols-[1fr_auto_auto] gap-x-3 gap-y-0.5 text-xs">
                          <span className="text-muted-foreground text-[10px]">Date</span>
                          <span className="text-muted-foreground text-[10px] text-right hidden sm:block">Ate / Burn</span>
                          <span className="text-muted-foreground text-[10px] text-right">Deficit / Goal</span>
                          {trend7d.days.map((d: any) => {
                            const dayLabel = new Date(d.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric" });
                            const deficitColor = d.deficit <= -trend7d.goalDeficit ? "text-green-500"
                              : d.deficit < 0 ? "text-amber-500"
                              : d.deficit > 0 ? "text-rose-500" : "text-muted-foreground";
                            const isInProgress = d.isToday && !d.closed;
                            return (
                              <React.Fragment key={d.date}>
                                <span>
                                  {dayLabel}
                                  <span className="block sm:hidden text-[9px] text-muted-foreground/60">
                                    ate {isInProgress ? `(${d.ate})` : d.ate} · burn {d.burn}
                                  </span>
                                </span>
                                <span className={`tabular-nums text-right hidden sm:block ${isInProgress ? "text-muted-foreground" : ""}`}>
                                  {isInProgress ? `(${d.ate})` : d.ate || "\u2013"} / {d.burn || "\u2013"}
                                </span>
                                <span className={`tabular-nums text-right font-medium ${isInProgress ? "text-muted-foreground" : deficitColor}`}>
                                  {isInProgress
                                    ? `(${d.deficit > 0 ? "+" : ""}${d.deficit})`
                                    : d.ate > 0 ? `${d.deficit > 0 ? "+" : ""}${d.deficit}` : "\u2013"
                                  } / &minus;{trend7d.goalDeficit}
                                </span>
                              </React.Fragment>
                            );
                          })}
                          {/* Total */}
                          {trend7d.closedDays > 0 && (() => {
                            const total = trend7d.totalDeficit; // negative = deficit
                            const goal = -(trend7d.closedDays * trend7d.goalDeficit); // negative target
                            return (
                              <React.Fragment key="trend-total">
                                <span className="font-medium border-t pt-1">Total ({trend7d.closedDays}d)</span>
                                <span className="border-t pt-1 hidden sm:block" />
                                <span className={`tabular-nums text-right font-bold border-t pt-1 ${total <= goal ? "text-green-500" : "text-amber-500"}`}>
                                  {total > 0 ? "+" : ""}{Math.round(total)} / {goal}
                                </span>
                              </React.Fragment>
                            );
                          })()}
                        </div>
                        {trend7d.days.some((d: any) => d.manual) && (
                          <div className="text-[9px] text-muted-foreground/60">* offset target in parentheses · +/− vs {trend7d.goalDeficit}/day goal</div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Macro bars (always visible) */}
              {dataReady ? (
                <div className="grid gap-2 pt-1">
                  <MacroBar label="Protein" current={consumedProtein} target={targetProtein}
                    color="bg-blue-500" floor={targetProtein} ceiling={null} />
                  <MacroBar label="Carbs" current={consumedCarbs} target={targetCarbs}
                    color="bg-amber-500" floor={targetCarbs} ceiling={null} />
                  <MacroBar label="Fat" current={consumedFat} target={targetFat}
                    color="bg-rose-500" floor={targetFat} ceiling={null} />
                  {targetFiber > 0 && (
                    <MacroBar label="Fiber" current={consumedFiber} target={targetFiber}
                      color="bg-green-500" floor={targetFiber} ceiling={60} />
                  )}
                </div>
              ) : (
                <div className="h-24" />
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="pt-4 text-center text-sm text-muted-foreground">
              No nutrition plan generated for today. Run the daily plan generator
              to get started.
            </CardContent>
          </Card>
        )}

        {/* Training / health strip */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground overflow-x-auto">
          {training && (
            <div className="flex items-center gap-1 shrink-0">
              {training.gym_workout ? (
                <Dumbbell className="h-3.5 w-3.5" />
              ) : (
                <Footprints className="h-3.5 w-3.5" />
              )}
              <span className="font-medium text-foreground">
                {training.run_title || training.gym_workout || training.run_type}
              </span>
              {Number(training.target_distance_km) > 0 && (
                <span>({Number(training.target_distance_km).toFixed(1)}km)</span>
              )}
              {training.load_level && (
                <Badge variant="outline" className="text-[10px] px-1 py-0">
                  {training.load_level}
                </Badge>
              )}
            </div>
          )}
          {health?.total_steps && (
            <div className="flex items-center gap-1 shrink-0">
              <Footprints className="h-3.5 w-3.5" />
              <span>{Number(health.total_steps).toLocaleString()} steps</span>
            </div>
          )}
          {sleepHours && (
            <div className="flex items-center gap-1 shrink-0">
              <Moon className="h-3.5 w-3.5" />
              <span>{sleepHours}h sleep</span>
              {sleep?.sleep_score && (
                <span className="text-muted-foreground/70">
                  (score {sleep.sleep_score})
                </span>
              )}
            </div>
          )}
        </div>

        {/* Activity selector */}
        <ActivitySelector
          date={date}
          training={training}
          runEnabled={runEnabled}
          selectedWorkouts={selectedWorkouts}
          exerciseCalories={Number(plan?.exercise_calories) || 0}
          expectedSteps={breakdown?.expectedSteps || Number(plan?.step_goal) || 10000}
          stepGoal={Number(plan?.step_goal) || 10000}
          runStepEstimate={breakdown?.runStepEstimate || 0}
          onActivityChanged={refreshData}
          disabled={(() => {
            const isPast = date < new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
            const hasActuals = breakdown?.runActual || breakdown?.gymBreakdown?.some((w: any) => w.actual);
            return breakdown?.manualOverride || (isPast && hasActuals) || isClosed;
          })()}
          disabledReason={
            breakdown?.manualOverride ? "Target locked — offset plan"
            : isClosed ? "Day is closed"
            : "Activities finalized"
          }
        />

        <div className="hidden lg:block">
          <PrepSummary meals={meals} ingredients={ingredients} desktop />
        </div>
      </div>

      {/* ── RIGHT COLUMN: meals, drinks, close day ── */}
      <div className="space-y-4">
        <div className="lg:hidden">
          <PrepSummary meals={meals} ingredients={ingredients} />
        </div>

        {/* Quick actions */}
        {!isClosed && meals.length === 0 && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              disabled={copying}
              onClick={async () => {
                setCopying(true);
                try {
                  const yesterday = (() => {
                    const d = new Date(date + "T12:00:00");
                    d.setDate(d.getDate() - 1);
                    return d.toISOString().slice(0, 10);
                  })();
                  const res = await fetch("/api/nutrition/copy-day", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ from_date: yesterday, to_date: date }),
                  });
                  if (res.ok) {
                    await refreshData();
                  }
                } finally {
                  setCopying(false);
                }
              }}
            >
              {copying ? "Copying..." : "Copy Yesterday"}
            </Button>
          </div>
        )}

        {/* Meal cards */}
        {slots.map((slot) => {
          // Day-level macros (raw, no live preview) so each compose view can render
          // daily-progress bars: "if I log this meal, where does my day end up?"
          const dayConsumedRaw = {
            protein: meals.reduce((s, m) => s + Number(m.protein || 0), 0),
            carbs:
              meals.reduce((s, m) => s + Number(m.carbs || 0), 0) +
              drinks.reduce((s, d) => s + Number(d.carbs || 0), 0),
            fat: meals.reduce((s, m) => s + Number(m.fat || 0), 0),
            fiber: meals.reduce((s, m) => s + Number(m.fiber || 0), 0),
          };
          return (
            <MealCard
              key={slot}
              slot={slot}
              meals={meals.filter((m) => m.meal_slot === slot)}
              presets={presets}
              ingredients={ingredients}
              slotBudget={slotBudgets?.[slot] ?? null}
              dayTargets={{ protein: targetProtein, carbs: targetCarbs, fat: targetFat, fiber: targetFiber }}
              dayConsumed={dayConsumedRaw}
              skipped={skippedSlots.includes(slot)}
              date={date}
              disabled={isClosed}
              onMealLogged={(slot?: string) => handleMealChanged(slot)}
              onSlotSkipped={refreshData}
              onTotalsPreview={handleTotalsPreview}
              locked={lockedSlots.has(slot)}
              onLockToggle={handleLockToggle}
            />
          );
        })}

        {/* Drink logger */}
        <DrinkLogger
          drinks={drinks}
          date={date}
          disabled={isClosed}
          onDrinkLogged={() => handleMealChanged()}
        />

        {/* Close Day button */}
        {!isClosed && targetCal > 0 && (
          <Button
            variant="outline"
            className="w-full"
            onClick={handleCloseDay}
            disabled={closing}
          >
            {closing ? "Closing..." : "Close Day"}
          </Button>
        )}
      </div>
      {rebalanceToast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-card border border-border rounded-lg px-4 py-2 text-sm shadow-lg z-50 max-w-sm text-center animate-in fade-in slide-in-from-bottom-2">
          Adjusted: {rebalanceToast}
          <button onClick={() => setRebalanceToast(null)} className="ml-2 text-muted-foreground hover:text-foreground">{"\u2715"}</button>
        </div>
      )}
    </div>
  );
}
