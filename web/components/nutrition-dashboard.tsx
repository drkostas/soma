"use client";

import { useState, useCallback } from "react";
import { AlertTriangle, Lock, Moon, Footprints, Dumbbell, ChevronLeft, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { MealCard } from "@/components/meal-card";
import { DrinkLogger } from "@/components/drink-logger";

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
  training,
  health,
  sleep,
}: NutritionDashboardProps) {
  const [plan, setPlan] = useState(initialPlan);
  const [meals, setMeals] = useState<Meal[]>(initialMeals);
  const [drinks, setDrinks] = useState<Drink[]>(initialDrinks);
  const [closing, setClosing] = useState(false);
  const [copying, setCopying] = useState(false);
  const [workoutEnabled, setWorkoutEnabled] = useState(true);

  const isClosed = plan?.status === "closed";

  const refreshData = useCallback(async () => {
    try {
      const res = await fetch(`/api/nutrition/plan?date=${date}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.plan) setPlan(data.plan);
      if (data.meals) setMeals(data.meals);
      if (data.drinks) setDrinks(data.drinks);
    } catch {
      // silent refresh failure
    }
  }, [date]);

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

  const exerciseCal = Number(plan?.exercise_calories) || 0;
  const targetCal = workoutEnabled
    ? (Number(plan?.target_calories) || 0)
    : (Number(plan?.target_calories) || 0) - exerciseCal;
  const targetProtein = Number(plan?.target_protein) || 0;
  const targetCarbs = Number(plan?.target_carbs) || 0;
  const targetFat = Number(plan?.target_fat) || 0;
  const targetFiber = Number(plan?.target_fiber) || 0;
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
            <div className="text-center">
              <div
                className={`text-4xl font-bold tabular-nums ${
                  remainingCal < 0 ? "text-muted-foreground" : ""
                }`}
              >
                {Math.round(remainingCal)}
              </div>
              <div className="text-xs text-muted-foreground">
                calories remaining
              </div>
            </div>
            <Progress
              value={Math.min(100, (consumedCal / targetCal) * 100)}
              className="h-3"
            />
            <div className="text-xs text-center text-muted-foreground">
              {Math.round(consumedCal)} / {Math.round(targetCal)} kcal
            </div>
            {plan && (
              <div className="text-xs text-muted-foreground space-y-0.5 text-center">
                <div>BMR: {Math.round((Number(plan?.tdee_used) || 0) - (Number(plan?.exercise_calories) || 0) - (Number(plan?.step_calories) || 0))} kcal</div>
                <div>Steps ({(Number(plan?.step_goal) || 10000).toLocaleString()}): +{Math.round(Number(plan?.step_calories) || 0)} kcal</div>
                {Number(plan?.exercise_calories) > 0 && <div>Workout: +{Math.round(Number(plan?.exercise_calories))} kcal</div>}
                <div>Deficit: -{Math.round(Number(plan?.deficit_used) || 0)} kcal</div>
              </div>
            )}
            <div className="grid gap-2 pt-1">
              <MacroBar
                label="Protein"
                current={consumedProtein}
                target={targetProtein}
                color="[&>[data-slot=progress-indicator]]:bg-blue-500"
              />
              <MacroBar
                label="Carbs"
                current={consumedCarbs}
                target={targetCarbs}
                color="[&>[data-slot=progress-indicator]]:bg-amber-500"
              />
              <MacroBar
                label="Fat"
                current={consumedFat}
                target={targetFat}
                color="[&>[data-slot=progress-indicator]]:bg-rose-500"
              />
              {targetFiber > 0 && (
                <MacroBar
                  label="Fiber"
                  current={consumedFiber}
                  target={targetFiber}
                  color="[&>[data-slot=progress-indicator]]:bg-green-500"
                />
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
            {exerciseCal > 0 && (
              <Button
                variant={workoutEnabled ? "default" : "outline"}
                size="sm"
                className="h-6 text-xs ml-1"
                onClick={() => setWorkoutEnabled(!workoutEnabled)}
              >
                {workoutEnabled ? "ON" : "OFF"}
              </Button>
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
          date={date}
          disabled={isClosed}
          onMealLogged={refreshData}
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
