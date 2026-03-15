"use client";

import React, { useState, useCallback, useEffect } from "react";
import { AlertTriangle, Lock, Moon, Footprints, Dumbbell, ChevronLeft, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { MealCard } from "@/components/meal-card";
import { DrinkLogger } from "@/components/drink-logger";
import { ActivitySelector } from "@/components/activity-selector";

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

function MacroBar({
  label,
  current,
  target,
  color,
}: {
  label: string;
  current: number;
  target: number;
  color: string;
}) {
  const pct = target > 0 ? Math.min(100, (current / target) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span>
          {Math.round(current)}/{Math.round(target)}g
        </span>
      </div>
      <Progress value={pct} className={`h-2 ${color}`} />
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────

export function NutritionDashboard({
  date,
  plan: initialPlan,
  meals: initialMeals,
  drinks: initialDrinks,
  presets,
  ingredients,
  training,
  health,
  sleep,
}: NutritionDashboardProps) {
  const [plan, setPlan] = useState(initialPlan);
  const [meals, setMeals] = useState<Meal[]>(initialMeals);
  const [drinks, setDrinks] = useState<Drink[]>(initialDrinks);
  const [closing, setClosing] = useState(false);
  const [copying, setCopying] = useState(false);
  // workoutEnabled removed — activity toggles now flow through API via ActivitySelector
  const [runEnabled, setRunEnabled] = useState<boolean>(initialPlan?.run_enabled ?? true);
  const [selectedWorkouts, setSelectedWorkouts] = useState<string[]>(initialPlan?.selected_workouts ?? []);
  const [gymCalories, setGymCalories] = useState<number>(0);
  const [skippedSlots, setSkippedSlots] = useState<string[]>(initialPlan?.skipped_slots ?? []);
  const [slotBudgets, setSlotBudgets] = useState<Record<string, Record<string, number>> | null>(null);
  const [budgetExpanded, setBudgetExpanded] = useState(false);
  const [breakdown, setBreakdown] = useState<any>(null);
  const [trend7d, setTrend7d] = useState<any>(null);
  const [dataReady, setDataReady] = useState(false);

  const isClosed = plan?.status === "closed";

  const refreshData = useCallback(async () => {
    try {
      const res = await fetch(`/api/nutrition/plan?date=${date}`);
      if (!res.ok) return;
      const data = await res.json();
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
      setDataReady(true);
    } catch {
      setDataReady(true); // still mark ready on error
    }
  }, [date]);

  // Load breakdown + trend data on mount
  useEffect(() => {
    refreshData();
  }, [refreshData]);

  // Compute consumed totals
  const consumedCal =
    meals.reduce((s, m) => s + Number(m.calories || 0), 0) +
    drinks.reduce((s, d) => s + Number(d.calories || 0), 0);
  const consumedProtein = meals.reduce(
    (s, m) => s + Number(m.protein || 0),
    0
  );
  const consumedCarbs =
    meals.reduce((s, m) => s + Number(m.carbs || 0), 0) +
    drinks.reduce((s, d) => s + Number(d.carbs || 0), 0);
  const consumedFat = meals.reduce((s, m) => s + Number(m.fat || 0), 0);
  const consumedFiber = meals.reduce((s, m) => s + Number(m.fiber || 0), 0);

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
    <div className="space-y-4">
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
        </div>
        <a href={`/nutrition?date=${(() => { const d = new Date(date + "T12:00:00"); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); })()}`}>
          <Button variant="ghost" size="icon"><ChevronRight className="h-4 w-4" /></Button>
        </a>
      </div>

      {/* Sleep adjustment banner */}
      {adjustmentReason && adjustmentReason !== "normal" && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
          <span>
            {adjustmentReason === "sleep_mild"
              ? "Mild sleep deficit — targets slightly adjusted"
              : adjustmentReason === "sleep_moderate" || adjustmentReason === "sleep_moderate_escalated"
              ? "Moderate sleep deficit — deficit halved for recovery"
              : adjustmentReason === "sleep_severe" || adjustmentReason === "sleep_severe_escalated"
              ? "Severe sleep deficit — eating at maintenance today"
              : adjustmentReason === "sleep_forced_maintenance"
              ? "Forced maintenance — poor sleep streak"
              : adjustmentReason === "sleep_diet_break_recommended"
              ? "Diet break recommended — sustained poor sleep"
              : "Sleep adjustment active"}
          </span>
        </div>
      )}

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
                  <div className={`text-4xl font-bold tabular-nums ${remainingCal < 0 ? "text-muted-foreground" : ""}`}>
                    {Math.round(remainingCal)}
                  </div>
                  <div className="text-xs text-muted-foreground">calories remaining</div>
                </>
              )}
            </div>
            {dataReady && (
              <>
                <Progress value={Math.min(100, (consumedCal / targetCal) * 100)} className="h-3" />
                <div className="text-xs text-center text-muted-foreground">
                  {Math.round(consumedCal)} / {Math.round(targetCal)} kcal
                </div>
              </>
            )}

            {/* One-line equation summary — only after dynamic data loads */}
            {dataReady && breakdown && (
              <div className="text-[10px] text-muted-foreground text-center">
                {breakdown.bmr} BMR
                {breakdown.stepCalories > 0 && ` + ${breakdown.stepCalories} steps`}
                {breakdown.runCalories > 0 && ` + ${breakdown.runCalories} run${breakdown.runActual ? " \u2713" : " ~"}`}
                {breakdown.gymBreakdown && breakdown.gymBreakdown.length > 0
                  ? breakdown.gymBreakdown.map((w: any) => ` + ${w.calories} ${w.title}${w.actual ? " \u2713" : " ~"}`).join("")
                  : breakdown.gymCalories > 0 ? ` + ${breakdown.gymCalories} gym` : ""}
                {breakdown.deficit > 0 && ` \u2212 ${breakdown.deficit} deficit`}
                {breakdown.drinkCalories > 0 && ` \u2212 ${breakdown.drinkCalories} drinks`}
                {` = ${breakdown.targetIntake}`}
              </div>
            )}

            {/* 7-day trend summary (always visible) */}
            {trend7d && trend7d.closedDays > 0 && (
              <div className={`text-xs text-center font-medium ${
                trend7d.totalDelta < 0 ? "text-green-500" : trend7d.totalDelta > 0 ? "text-amber-500" : "text-muted-foreground"
              }`}>
                7d: {trend7d.totalDelta > 0 ? "+" : ""}{trend7d.totalDelta} kcal ({trend7d.closedDays}d avg: {trend7d.closedDays > 0 ? Math.round(trend7d.totalDelta / trend7d.closedDays) : 0})
              </div>
            )}

            {/* Expand/collapse toggle */}
            <button
              className="w-full text-[10px] text-muted-foreground text-center hover:text-foreground transition-colors"
              onClick={() => setBudgetExpanded(!budgetExpanded)}
            >
              {budgetExpanded ? "\u25B2 hide details" : "\u25BC show details"}
            </button>

            {/* Expanded breakdown */}
            {budgetExpanded && breakdown && (
              <div className="space-y-3 border-t pt-3">
                {/* Calorie equation breakdown */}
                <div className="space-y-1">
                  <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Calorie Breakdown</div>
                  <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 text-xs">
                    <span className="text-muted-foreground">Passive burn (BMR)</span>
                    <span className="tabular-nums text-right">{breakdown.bmr}</span>

                    <span className="text-muted-foreground">
                      Steps ({(breakdown.expectedSteps || breakdown.stepGoal || 10000).toLocaleString()}{breakdown.expectedSteps && breakdown.expectedSteps !== breakdown.stepGoal ? ` / ${(breakdown.stepGoal || 10000).toLocaleString()} goal` : " goal"})
                      {breakdown.runStepEstimate > 0 && (
                        <span className="text-[10px]"> excl. ~{breakdown.runStepEstimate} run steps</span>
                      )}
                    </span>
                    <span className="tabular-nums text-right text-green-500">+{breakdown.stepCalories}</span>

                    {breakdown.runCalories > 0 && (
                      <>
                        <span className="text-muted-foreground">
                          Run ({breakdown.runDistanceKm}km)
                          <span className={`ml-1 text-[9px] ${breakdown.runActual ? "text-green-500" : "text-amber-500"}`}>
                            {breakdown.runActual ? "actual" : "predicted"}
                          </span>
                        </span>
                        <span className="tabular-nums text-right text-green-500">+{breakdown.runCalories}</span>
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
                          <span className="tabular-nums text-right text-green-500">+{w.calories}</span>
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
                    <span className="tabular-nums text-right font-medium border-t pt-1">{breakdown.totalBurn}</span>

                    <span className="text-muted-foreground">Deficit goal</span>
                    <span className="tabular-nums text-right text-rose-500">&minus;{breakdown.deficit}</span>

                    {breakdown.drinkCalories > 0 && (
                      <>
                        <span className="text-muted-foreground">Drinks (alcohol)</span>
                        <span className="tabular-nums text-right text-rose-500">&minus;{breakdown.drinkCalories}</span>
                      </>
                    )}

                    <span className="font-medium border-t pt-1">Target intake</span>
                    <span className="tabular-nums text-right font-bold border-t pt-1">{breakdown.targetIntake}</span>
                  </div>
                </div>

                {/* Per-slot budget */}
                {slotBudgets && (
                  <div className="space-y-1">
                    <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Per-Meal Budget</div>
                    <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-x-3 gap-y-0.5 text-xs">
                      <span className="text-muted-foreground text-[10px]">Slot</span>
                      <span className="text-muted-foreground text-[10px] text-right">kcal</span>
                      <span className="text-muted-foreground text-[10px] text-right">P</span>
                      <span className="text-muted-foreground text-[10px] text-right">C</span>
                      <span className="text-muted-foreground text-[10px] text-right">F</span>
                      <span className="text-muted-foreground text-[10px] text-right">Fi</span>
                      {Object.entries(slotBudgets).map(([slot, macros]: [string, any]) => (
                        <React.Fragment key={slot}>
                          <span className={skippedSlots.includes(slot) ? "text-muted-foreground/50 line-through" : ""}>
                            {slot.replace("_", "-")}
                          </span>
                          <span className="tabular-nums text-right">{Math.round(macros.calories)}</span>
                          <span className="tabular-nums text-right text-blue-500">{Math.round(macros.protein)}</span>
                          <span className="tabular-nums text-right text-amber-500">{Math.round(macros.carbs)}</span>
                          <span className="tabular-nums text-right text-rose-500">{Math.round(macros.fat)}</span>
                          <span className="tabular-nums text-right text-green-500">{Math.round(macros.fiber || 0)}</span>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                )}

                {/* 7-day trend table */}
                {trend7d && trend7d.days.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">7-Day Trend</div>
                    <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 gap-y-0.5 text-xs">
                      <span className="text-muted-foreground text-[10px]">Date</span>
                      <span className="text-muted-foreground text-[10px] text-right">Target</span>
                      <span className="text-muted-foreground text-[10px] text-right">Actual</span>
                      <span className="text-muted-foreground text-[10px] text-right">+/&minus;</span>
                      {trend7d.days.map((d: any) => {
                        const dayLabel = new Date(d.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric" });
                        return (
                          <React.Fragment key={d.date}>
                            <span>{dayLabel}</span>
                            <span className="tabular-nums text-right">{d.target || "\u2013"}</span>
                            <span className="tabular-nums text-right">{d.closed ? d.actual : "\u2013"}</span>
                            <span className={`tabular-nums text-right ${
                              d.delta == null ? "text-muted-foreground" : d.delta < 0 ? "text-green-500" : d.delta > 0 ? "text-amber-500" : ""
                            }`}>
                              {d.delta != null ? (d.delta > 0 ? `+${d.delta}` : d.delta) : "\u2013"}
                            </span>
                          </React.Fragment>
                        );
                      })}
                      {/* Total row */}
                      {trend7d.closedDays > 0 && (
                        <React.Fragment key="trend-total">
                          <span className="font-medium border-t pt-1">Total</span>
                          <span className="border-t pt-1" />
                          <span className="border-t pt-1" />
                          <span className={`tabular-nums text-right font-bold border-t pt-1 ${
                            trend7d.totalDelta < 0 ? "text-green-500" : trend7d.totalDelta > 0 ? "text-amber-500" : ""
                          }`}>
                            {trend7d.totalDelta > 0 ? `+${trend7d.totalDelta}` : trend7d.totalDelta}
                          </span>
                        </React.Fragment>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Macro bars (always visible) */}
            <div className="grid gap-2 pt-1">
              <MacroBar label="Protein" current={consumedProtein} target={targetProtein}
                color="[&>[data-slot=progress-indicator]]:bg-blue-500" />
              <MacroBar label="Carbs" current={consumedCarbs} target={targetCarbs}
                color="[&>[data-slot=progress-indicator]]:bg-amber-500" />
              <MacroBar label="Fat" current={consumedFat} target={targetFat}
                color="[&>[data-slot=progress-indicator]]:bg-rose-500" />
              {targetFiber > 0 && (
                <MacroBar label="Fiber" current={consumedFiber} target={targetFiber}
                  color="[&>[data-slot=progress-indicator]]:bg-green-500" />
              )}
            </div>
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
            {training.target_distance_km && (
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
      />

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
      {slots.map((slot) => (
        <MealCard
          key={slot}
          slot={slot}
          meals={meals.filter((m) => m.meal_slot === slot)}
          presets={presets}
          ingredients={ingredients}
          slotBudget={slotBudgets?.[slot] ?? null}
          skipped={skippedSlots.includes(slot)}
          date={date}
          disabled={isClosed}
          onMealLogged={refreshData}
          onSlotSkipped={refreshData}
        />
      ))}

      {/* Drink logger */}
      <DrinkLogger
        drinks={drinks}
        date={date}
        disabled={isClosed}
        onDrinkLogged={refreshData}
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
  );
}
