"use client";

import { useState } from "react";
import { WorkoutDetailModal } from "./workout-detail-modal";

interface Workout {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  exercise_count: number;
  exercises: any[];
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
    for (const s of ex.sets) {
      if (s.type === "normal" && s.weight_kg > 0 && s.reps > 0) {
        totalSets++;
        totalVolume += s.weight_kg * s.reps;
      }
    }
  }
  return { totalSets, totalVolume };
}

export function ClickableWorkoutList({ workouts }: { workouts: Workout[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <>
      <div className="space-y-3">
        {workouts.map((w) => {
          const exercises = typeof w.exercises === "string" ? JSON.parse(w.exercises) : w.exercises;
          const { totalSets, totalVolume } = getWorkingSets(exercises);
          return (
            <div
              key={w.id}
              className="border-b border-border/50 last:border-0 pb-3 last:pb-0 cursor-pointer hover:bg-accent/20 -mx-2 px-2 py-1 rounded transition-colors"
              onClick={() => setSelectedId(w.id)}
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
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>{formatDuration(w.start_time, w.end_time)}</span>
                <span>{Number(w.exercise_count)} exercises</span>
                <span>{totalSets} sets</span>
                <span>{Math.round(totalVolume).toLocaleString()} kg</span>
              </div>
            </div>
          );
        })}
      </div>
      <WorkoutDetailModal workoutId={selectedId} onClose={() => setSelectedId(null)} />
    </>
  );
}
