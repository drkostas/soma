"use client";

import { useState } from "react";
import { ExerciseDetailModal } from "@/components/exercise-detail-modal";

interface PR {
  exercise: string;
  pr_weight: number;
  reps_at_pr: number | null;
}

export function ClickablePersonalRecords({ records }: { records: PR[] }) {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {records.map((pr) => (
          <div
            key={pr.exercise}
            className="border border-border/50 rounded-lg p-3 cursor-pointer hover:bg-accent/10 hover:border-border transition-colors"
            onClick={() => setSelected(pr.exercise)}
          >
            <div className="text-xs text-muted-foreground truncate mb-1">{pr.exercise}</div>
            <div className="text-lg font-bold">{Number(pr.pr_weight).toFixed(1)} kg</div>
            {pr.reps_at_pr && (
              <div className="text-xs text-muted-foreground">
                {pr.reps_at_pr} reps
              </div>
            )}
          </div>
        ))}
      </div>
      <ExerciseDetailModal exerciseName={selected} onClose={() => setSelected(null)} />
    </>
  );
}
