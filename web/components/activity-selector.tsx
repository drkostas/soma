"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/number-input";

interface TrainingDay {
  run_type: string | null;
  run_title: string | null;
  target_distance_km: number | null;
  target_duration_min: number | null;
  load_level: string | null;
  gym_workout: string | null;
  plan_name: string | null;
}

interface RoutineCalories {
  hevy_title: string;
  avg_calories: number;
  avg_duration_s: number;
  session_count: number;
}

interface ActivitySelectorProps {
  date: string;
  training: TrainingDay | null;
  runEnabled: boolean;
  selectedWorkouts: string[];
  exerciseCalories: number;
  expectedSteps: number;
  stepGoal: number;
  runStepEstimate: number;
  /** True when a real Garmin-completed run was found for `date`. */
  runActual?: boolean;
  /** Distance of the actual completed run, km. */
  actualRunKm?: number;
  /** Calories of the actual completed run. */
  actualRunCalories?: number;
  /** Ad-hoc planned run distance in km. User can set this for unplanned runs
   *  (between training blocks or ad-hoc) so calories are pre-allocated to the
   *  day's target. NULL/0 = no ad-hoc plan; falls back to training_plan_day. */
  plannedRunKm?: number | null;
  /** User weight (kg) — used to compute the live "X km × Y kg ≈ Z kcal" hint. */
  weightKg?: number | null;
  onActivityChanged: () => void;
  disabled?: boolean;
  disabledReason?: string;
}

export function ActivitySelector({
  date,
  training,
  runEnabled: initialRunEnabled,
  selectedWorkouts: initialSelectedWorkouts,
  exerciseCalories,
  expectedSteps: initialExpectedSteps,
  stepGoal,
  runStepEstimate,
  runActual,
  actualRunKm,
  actualRunCalories,
  plannedRunKm: initialPlannedRunKm,
  weightKg,
  onActivityChanged,
  disabled,
  disabledReason,
}: ActivitySelectorProps) {
  const [runEnabled, setRunEnabled] = useState(initialRunEnabled);
  const [selectedWorkouts, setSelectedWorkouts] = useState<string[]>(initialSelectedWorkouts);
  const [steps, setSteps] = useState(initialExpectedSteps || stepGoal);
  const [plannedRunKm, setPlannedRunKm] = useState<number>(initialPlannedRunKm ?? 0);
  const [routines, setRoutines] = useState<RoutineCalories[]>([]);
  const [saving, setSaving] = useState(false);
  const minSteps = 1000; // allow setting any reasonable step count

  // Sync steps + planned-run-km from parent when props change (after refreshData)
  useEffect(() => {
    setSteps(initialExpectedSteps || stepGoal);
  }, [initialExpectedSteps, stepGoal]);
  useEffect(() => {
    setPlannedRunKm(initialPlannedRunKm ?? 0);
  }, [initialPlannedRunKm]);

  // Fetch available routines with their average calories
  useEffect(() => {
    fetch("/api/nutrition/workout-calories")
      .then((res) => res.json())
      .then((data) => setRoutines(data.routines ?? []))
      .catch(() => {});
  }, []);

  const saveSelections = useCallback(
    async (run: boolean, workouts: string[], stepsOverride?: number, plannedRunKmOverride?: number | null) => {
      setSaving(true);
      try {
        const body: Record<string, unknown> = {
          date,
          run_enabled: run,
          selected_workouts: workouts,
          expected_steps: stepsOverride ?? steps,
        };
        if (plannedRunKmOverride !== undefined) {
          body.planned_run_km = plannedRunKmOverride && plannedRunKmOverride > 0 ? plannedRunKmOverride : null;
        }
        const res = await fetch("/api/nutrition/activity-select", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          onActivityChanged();
        }
      } finally {
        setSaving(false);
      }
    },
    [date, onActivityChanged, steps],
  );

  const toggleRun = () => {
    const next = !runEnabled;
    setRunEnabled(next);
    // Don't force steps up — user controls their own expected steps
    saveSelections(next, selectedWorkouts, steps);
  };

  const toggleWorkout = (title: string) => {
    const next = selectedWorkouts.includes(title)
      ? selectedWorkouts.filter((w) => w !== title)
      : [...selectedWorkouts, title];
    setSelectedWorkouts(next);
    saveSelections(runEnabled, next, steps);
  };

  // Debounced save for slider-driven changes (steps, planned_run_km)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedSave = useCallback(
    (overrides: { expected_steps?: number; planned_run_km?: number | null }) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveSelections(
          runEnabled,
          selectedWorkouts,
          overrides.expected_steps ?? steps,
          overrides.planned_run_km,
        );
      }, 400);
    },
    [runEnabled, selectedWorkouts, steps, saveSelections],
  );

  const hasRun = !!(training && training.target_distance_km && training.target_distance_km > 0);

  return (
    <div className={disabled ? "opacity-50 pointer-events-none" : ""}>
      <Card>
        <CardContent className="py-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Today&apos;s Activity
            </span>
            {saving && (
              <span className="text-[10px] text-muted-foreground animate-pulse">
                saving...
              </span>
            )}
          </div>

          {/* Actual completed run (Garmin) — read-only row.
              Renders whenever a real run is detected for `date`, even when
              there's no matching planned run in training_plan. Takes
              precedence over the planned-run toggle since the actual data
              is what actually drives the day's burn calculation. */}
          {runActual && actualRunKm && actualRunKm > 0 ? (
            <div className="w-full flex items-center justify-between rounded-md px-3 py-2 text-sm bg-primary/10 border border-primary/30">
              <div className="flex items-center gap-2">
                <span>🏃</span>
                <div className="text-left">
                  <div className="font-medium text-xs">
                    {training?.run_title || "Run"}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {actualRunKm}km
                    {actualRunCalories ? ` · ${actualRunCalories}cal` : ""}
                  </div>
                </div>
              </div>
              <span className="text-[10px] uppercase tracking-wide text-emerald-500 font-medium">
                actual
              </span>
            </div>
          ) : hasRun ? (
            /* Planned run toggle — only when no actual run exists yet. */
            <button
              className={`w-full flex items-center justify-between rounded-md px-3 py-2 text-sm transition-colors ${
                runEnabled
                  ? "bg-primary/10 border border-primary/30"
                  : "bg-muted/30 border border-transparent opacity-60"
              }`}
              onClick={toggleRun}
            >
              <div className="flex items-center gap-2">
                <span>🏃</span>
                <div className="text-left">
                  <div className="font-medium text-xs">
                    {training!.run_title || training!.run_type || "Run"}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {training!.target_distance_km}km
                    {training!.load_level && ` · ${training!.load_level}`}
                  </div>
                </div>
              </div>
              <span className="text-xs tabular-nums">
                {runEnabled ? "ON" : "OFF"}
              </span>
            </button>
          ) : null}

          {/* Ad-hoc planned run distance.
              Visible only when no actual run is detected and no coach-planned
              run exists for today (otherwise the planned-run toggle above
              already covers it). User can override either by entering a
              non-zero km value here. Predicted kcal ≈ km × weight × 1.0. */}
          {!runActual && !hasRun && (() => {
            const w = weightKg && weightKg > 0 ? weightKg : 0;
            const estKcal = w > 0 && plannedRunKm > 0
              ? Math.round(plannedRunKm * w)
              : 0;
            return (
              <div>
                <NumberInput
                  value={plannedRunKm}
                  onChange={(v) => {
                    const next = Math.max(0, v);
                    setPlannedRunKm(next);
                    debouncedSave({ planned_run_km: next > 0 ? next : null });
                  }}
                  min={0}
                  max={50}
                  step={0.5}
                  suffix="km"
                  label="Planned run (ad-hoc)"
                />
                {plannedRunKm > 0 && estKcal > 0 && (
                  <div className="text-[10px] text-muted-foreground/70 mt-0.5 ml-0.5">
                    🏃 ≈ {estKcal} kcal pre-allocated
                  </div>
                )}
              </div>
            );
          })()}

          {/* Expected steps */}
          <NumberInput
            value={steps}
            onChange={(v) => {
              setSteps(v);
              debouncedSave({ expected_steps: v });
            }}
            min={minSteps}
            max={30000}
            step={250}
            suffix="steps"
            label="Expected steps"
          />

          {/* Gym routine chips */}
          {routines.length > 0 && (
            <div>
              <span className="text-[10px] text-muted-foreground mb-1.5 block">
                Gym Workouts
              </span>
              <div className="flex flex-wrap gap-1.5">
                {routines.map((r) => {
                  const isSelected = selectedWorkouts.includes(r.hevy_title);
                  return (
                    <Button
                      key={r.hevy_title}
                      variant={isSelected ? "default" : "outline"}
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => toggleWorkout(r.hevy_title)}
                    >
                      {r.hevy_title}
                      <span className="ml-1 opacity-60">
                        {r.avg_calories}cal
                      </span>
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

          {/* No activity available */}
          {!hasRun && routines.length === 0 && (
            <div className="text-xs text-muted-foreground text-center py-1">
              No training data available
            </div>
          )}
        </CardContent>
      </Card>
      {disabled && (
        <div className="text-[10px] text-amber-500 mt-1">{disabledReason || "Activities finalized"}</div>
      )}
    </div>
  );
}
