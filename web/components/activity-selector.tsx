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
  onActivityChanged,
  disabled,
  disabledReason,
}: ActivitySelectorProps) {
  const [runEnabled, setRunEnabled] = useState(initialRunEnabled);
  const [selectedWorkouts, setSelectedWorkouts] = useState<string[]>(initialSelectedWorkouts);
  const [steps, setSteps] = useState(initialExpectedSteps || stepGoal);
  const [routines, setRoutines] = useState<RoutineCalories[]>([]);
  const [saving, setSaving] = useState(false);
  const minSteps = 1000; // allow setting any reasonable step count

  // Sync steps from parent when expectedSteps prop changes (e.g., after refreshData)
  useEffect(() => {
    setSteps(initialExpectedSteps || stepGoal);
  }, [initialExpectedSteps, stepGoal]);

  // Fetch available routines with their average calories
  useEffect(() => {
    fetch("/api/nutrition/workout-calories")
      .then((res) => res.json())
      .then((data) => setRoutines(data.routines ?? []))
      .catch(() => {});
  }, []);

  const saveSelections = useCallback(
    async (run: boolean, workouts: string[], stepsOverride?: number) => {
      setSaving(true);
      try {
        const res = await fetch("/api/nutrition/activity-select", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date,
            run_enabled: run,
            selected_workouts: workouts,
            expected_steps: stepsOverride ?? steps,
          }),
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

  // Debounced save for slider-driven changes (steps)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedSave = useCallback(
    (overrides: { expected_steps?: number }) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveSelections(
          runEnabled,
          selectedWorkouts,
          overrides.expected_steps ?? steps,
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

          {/* Run toggle */}
          {hasRun && (
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
          )}

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
