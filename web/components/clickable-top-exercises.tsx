"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ExerciseDetailModal } from "@/components/exercise-detail-modal";

interface Exercise {
  exercise: string;
  workout_count: number;
  best_weight: number;
  avg_weight: number;
  last_performed?: string;
  recent_weights?: number[];
}

function formatRecency(dateStr: string): { text: string; stale: boolean } {
  const now = new Date();
  const then = new Date(dateStr + "T00:00:00");
  const diffMs = now.getTime() - then.getTime();
  const days = Math.floor(diffMs / 86400000);
  if (days <= 0) return { text: "today", stale: false };
  if (days === 1) return { text: "1d ago", stale: false };
  if (days < 7) return { text: `${days}d ago`, stale: false };
  if (days < 14) return { text: "1w ago", stale: false };
  if (days < 30) return { text: `${Math.floor(days / 7)}w ago`, stale: false };
  if (days < 60) return { text: `${Math.floor(days / 30)}mo ago`, stale: true };
  return { text: `${Math.floor(days / 30)}mo ago`, stale: true };
}

function MiniSparkline({ values }: { values: number[] }) {
  if (values.length < 3) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 40, h = 16;
  const points = values.map((v, i) =>
    `${(i / (values.length - 1)) * w},${h - ((v - min) / range) * h}`
  ).join(" ");
  const trending = values[values.length - 1] > values[0];
  return (
    <svg width={w} height={h} className="shrink-0">
      <polyline points={points} fill="none"
        stroke={trending ? "oklch(62% 0.17 142)" : "oklch(60% 0.22 25)"}
        strokeWidth={1.5} />
    </svg>
  );
}

export function ClickableTopExercises({ exercises }: { exercises: Exercise[] }) {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <>
      <div className="space-y-2">
        {exercises.map((e, i) => {
          const recency = e.last_performed ? formatRecency(e.last_performed) : null;
          return (
            <div
              key={e.exercise}
              className="flex items-center justify-between text-sm cursor-pointer hover:bg-accent/10 active:bg-accent/20 -mx-1.5 px-1.5 py-0.5 rounded transition-colors"
              onClick={() => setSelected(e.exercise)}
            >
              <div className="flex items-center gap-2 truncate mr-2">
                <span className="text-xs text-muted-foreground w-4">{i + 1}.</span>
                <div className="truncate">
                  <span className="truncate">{e.exercise}</span>
                  {recency && (
                    <span className={`text-[10px] ml-1.5 ${recency.stale ? "text-orange-400" : "text-muted-foreground"}`}>
                      {recency.text}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {e.recent_weights && e.recent_weights.length >= 3 && (
                  <MiniSparkline values={e.recent_weights} />
                )}
                <Badge variant="outline" className="text-xs">
                  {Number(e.best_weight).toFixed(0)}kg
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {Number(e.workout_count)}x
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <ExerciseDetailModal exerciseName={selected} onClose={() => setSelected(null)} />
    </>
  );
}
