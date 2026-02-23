"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ExerciseDetailModal } from "@/components/exercise-detail-modal";

interface Exercise {
  exercise: string;
  workout_count: number;
  best_weight: number;
  avg_weight: number;
}

export function ClickableTopExercises({ exercises }: { exercises: Exercise[] }) {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <>
      <div className="space-y-2">
        {exercises.map((e, i) => (
          <div
            key={e.exercise}
            className="flex items-center justify-between text-sm cursor-pointer hover:bg-accent/10 -mx-1.5 px-1.5 py-0.5 rounded transition-colors"
            onClick={() => setSelected(e.exercise)}
          >
            <div className="flex items-center gap-2 truncate mr-2">
              <span className="text-xs text-muted-foreground w-4">{i + 1}.</span>
              <span className="truncate">{e.exercise}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge variant="outline" className="text-xs">
                {Number(e.best_weight).toFixed(0)}kg
              </Badge>
              <span className="text-xs text-muted-foreground">
                {Number(e.workout_count)}x
              </span>
            </div>
          </div>
        ))}
      </div>
      <ExerciseDetailModal exerciseName={selected} onClose={() => setSelected(null)} />
    </>
  );
}
