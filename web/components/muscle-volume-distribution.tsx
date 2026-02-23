"use client";

import { useState, useMemo } from "react";

interface MuscleGroupData {
  muscle_group: string;
  total_sets: number;
  total_reps: number;
  exercise_count: number;
  total_volume: number;
}

type Metric = "volume" | "sets" | "reps" | "exercises";

const METRIC_LABELS: Record<Metric, string> = {
  volume: "Volume (kg)",
  sets: "Total Sets",
  reps: "Total Reps",
  exercises: "Exercises",
};

const MG_COLORS: Record<string, string> = {
  legs: "bg-blue-500",
  back: "bg-green-500",
  chest: "bg-red-500",
  shoulders: "bg-orange-500",
  biceps: "bg-cyan-500",
  triceps: "bg-purple-500",
  core: "bg-yellow-500",
  calves: "bg-emerald-500",
  forearms: "bg-pink-500",
};

function getValue(mg: MuscleGroupData, metric: Metric): number {
  switch (metric) {
    case "volume": return Number(mg.total_volume);
    case "sets": return Number(mg.total_sets);
    case "reps": return Number(mg.total_reps);
    case "exercises": return Number(mg.exercise_count);
  }
}

function formatValue(val: number, metric: Metric): string {
  switch (metric) {
    case "volume": return `${val.toLocaleString()} kg`;
    case "sets": return `${val} sets`;
    case "reps": return `${val.toLocaleString()} reps`;
    case "exercises": return `${val} exercises`;
  }
}

export function MuscleVolumeDistribution({ data }: { data: MuscleGroupData[] }) {
  const [metric, setMetric] = useState<Metric>("volume");

  // Sort by selected metric
  const sorted = useMemo(() => {
    return [...data].sort((a, b) => getValue(b, metric) - getValue(a, metric));
  }, [data, metric]);

  const maxVal = sorted.length > 0 ? getValue(sorted[0], metric) : 1;
  const totalVal = sorted.reduce((s, mg) => s + getValue(mg, metric), 0);

  return (
    <div>
      {/* Metric toggle */}
      <div className="flex gap-1 mb-4 p-0.5 bg-muted/50 rounded-lg w-fit">
        {(["volume", "sets", "reps", "exercises"] as Metric[]).map((m) => (
          <button
            key={m}
            onClick={() => setMetric(m)}
            className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
              metric === m
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {m === "volume" ? "Weight" : m === "exercises" ? "Exercises" : m.charAt(0).toUpperCase() + m.slice(1)}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {sorted.map((mg) => {
          const val = getValue(mg, metric);
          const pct = maxVal > 0 ? (val / maxVal) * 100 : 0;
          const totalPct = totalVal > 0 ? ((val / totalVal) * 100).toFixed(0) : "0";
          const barColor = MG_COLORS[mg.muscle_group] || "bg-purple-400";
          return (
            <div key={mg.muscle_group} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium capitalize">{mg.muscle_group}</span>
                <span className="text-muted-foreground">{totalPct}%</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full ${barColor} rounded-full transition-all duration-300`}
                  style={{ width: `${Math.max(pct, 5)}%` }}
                />
              </div>
              <div className="text-xs text-muted-foreground">
                {formatValue(val, metric)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
