"use client";

import { useState } from "react";
import { HeartPulse, Flame } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { WorkoutDetailModal } from "./workout-detail-modal";

const KG_TO_LBS = 2.20462;
type WeightUnit = "kg" | "lbs";

interface Workout {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  exercise_count: number;
  exercises: any[];
  avg_hr?: number;
  max_hr?: number;
  garmin_calories?: number;
}

function formatDuration(startTime: string, endTime: string): string {
  const ms = new Date(endTime).getTime() - new Date(startTime).getTime();
  const min = Math.round(ms / 60000);
  if (min >= 60) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${h}h ${m}m`;
  }
  return `${min}m`;
}

function getWorkingSets(exercises: any[]): { totalSets: number; totalVolume: number } {
  let totalSets = 0;
  let totalVolume = 0;
  for (const ex of exercises) {
    const sets = Array.isArray(ex.sets) ? ex.sets : [];
    for (const s of sets) {
      if (s.type === "normal" && s.weight_kg > 0 && s.reps > 0) {
        totalSets++;
        totalVolume += s.weight_kg * s.reps;
      }
    }
  }
  return { totalSets, totalVolume };
}

function WorkoutRow({
  w,
  unit,
  fmtVol,
  onClick,
}: {
  w: Workout;
  unit: WeightUnit;
  fmtVol: (kg: number) => string;
  onClick: () => void;
}) {
  const exercises = typeof w.exercises === "string" ? JSON.parse(w.exercises) : w.exercises;
  const { totalSets, totalVolume } = getWorkingSets(exercises);
  return (
    <div
      className="border-b border-border/50 last:border-0 pb-3 last:pb-0 cursor-pointer hover:bg-accent/20 -mx-2 px-2 py-1 rounded transition-colors"
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="font-medium text-sm">{w.title}</span>
        <span className="text-xs text-muted-foreground">
          {new Date(w.start_time).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })}
        </span>
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
        <span>{formatDuration(w.start_time, w.end_time)}</span>
        <span>{Number(w.exercise_count)} exercises</span>
        <span>{totalSets} sets</span>
        <span>{fmtVol(totalVolume)}</span>
        {w.garmin_calories && (
          <span className="flex items-center gap-0.5 text-orange-400">
            <Flame className="h-3 w-3" />
            {Math.round(w.garmin_calories)}
          </span>
        )}
        {w.avg_hr && (
          <span className="flex items-center gap-0.5 text-red-400">
            <HeartPulse className="h-3 w-3" />
            {Math.round(w.avg_hr)}
          </span>
        )}
      </div>
    </div>
  );
}

export function ClickableWorkoutList({ workouts, totalCount }: { workouts: Workout[]; totalCount?: number }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [unit, setUnit] = useState<WeightUnit>("kg");
  const [showAll, setShowAll] = useState(false);

  const PREVIEW_COUNT = 10;

  const fmtVol = (kg: number) =>
    unit === "lbs"
      ? `${Math.round(kg * KG_TO_LBS).toLocaleString()} lbs`
      : `${Math.round(kg).toLocaleString()} kg`;

  const unitToggle = (
    <button
      onClick={() => setUnit((u) => (u === "kg" ? "lbs" : "kg"))}
      className="px-2 py-0.5 rounded-md text-[10px] font-medium border border-border bg-muted/50 hover:bg-accent/50 transition-colors"
    >
      {unit === "kg" ? "kg → lbs" : "lbs → kg"}
    </button>
  );

  return (
    <>
      <div className="flex justify-end mb-2">{unitToggle}</div>
      <div className="space-y-3">
        {workouts.slice(0, PREVIEW_COUNT).map((w) => (
          <WorkoutRow
            key={w.id}
            w={w}
            unit={unit}
            fmtVol={fmtVol}
            onClick={() => setSelectedId(w.id)}
          />
        ))}
      </div>
      {workouts.length > PREVIEW_COUNT && (
        <button
          onClick={() => setShowAll(true)}
          className="w-full mt-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/30 rounded-md transition-colors border border-border/50"
        >
          Show all ({workouts.length - PREVIEW_COUNT} more)
        </button>
      )}

      {/* Full list modal */}
      <Dialog open={showAll} onOpenChange={setShowAll}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>All Recent Workouts</DialogTitle>
            <DialogDescription>
              {workouts.length} workouts{totalCount && totalCount > workouts.length ? ` (${totalCount} total)` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end mb-2">{unitToggle}</div>
          <div className="space-y-3">
            {workouts.map((w) => (
              <WorkoutRow
                key={w.id}
                w={w}
                unit={unit}
                fmtVol={fmtVol}
                onClick={() => {
                  setShowAll(false);
                  setSelectedId(w.id);
                }}
              />
            ))}
          </div>
          {totalCount && totalCount > workouts.length && (
            <p className="text-[10px] text-muted-foreground text-center mt-2">
              Use the calendar to browse older workouts
            </p>
          )}
        </DialogContent>
      </Dialog>

      <WorkoutDetailModal workoutId={selectedId} onClose={() => setSelectedId(null)} />
    </>
  );
}
