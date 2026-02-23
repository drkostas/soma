"use client";

import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MuscleBodyMap } from "./muscle-body-map";
import { type MuscleGroup, MUSCLE_LABELS, MUSCLE_COLORS, ALL_MUSCLE_GROUPS } from "@/lib/muscle-groups";
import { Activity } from "lucide-react";

interface MuscleVolumes {
  [key: string]: { primary: number; secondary: number; total: number };
}

type MetricKey = "volume" | "sets" | "reps" | "exercises";

const METRIC_LABELS: Record<MetricKey, string> = {
  volume: "Volume",
  sets: "Sets",
  reps: "Reps",
  exercises: "Exercises",
};

const METRIC_UNITS: Record<MetricKey, string> = {
  volume: "kg",
  sets: "sets",
  reps: "reps",
  exercises: "exercises",
};

interface Props {
  allMetrics: Record<MetricKey, MuscleVolumes>;
}

export function MuscleBodyMapSection({ allMetrics }: Props) {
  const [metric, setMetric] = useState<MetricKey>("volume");
  const [hoveredMuscle, setHoveredMuscle] = useState<MuscleGroup | null>(null);
  const volumes = allMetrics[metric] || allMetrics.volume;

  const handleHoverChange = useCallback((muscle: MuscleGroup | null) => {
    setHoveredMuscle(muscle);
  }, []);

  // Sort muscle groups by total
  const sorted = ALL_MUSCLE_GROUPS
    .filter(mg => (volumes[mg]?.total ?? 0) > 0)
    .sort((a, b) => (volumes[b]?.total ?? 0) - (volumes[a]?.total ?? 0));

  const maxTotal = sorted.length > 0 ? (volumes[sorted[0]]?.total ?? 1) : 1;
  const unit = METRIC_UNITS[metric];

  const formatVal = (n: number) => {
    if (metric === "volume") return Math.round(n).toLocaleString();
    if (metric === "exercises") return Math.round(n).toString();
    return Math.round(n).toLocaleString();
  };

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Activity className="h-4 w-4 text-emerald-400" />
          Muscle Activation Map
          <div className="ml-auto flex items-center gap-1">
            {(Object.keys(METRIC_LABELS) as MetricKey[]).map(k => (
              <button
                key={k}
                onClick={() => setMetric(k)}
                className={`px-2 py-0.5 rounded-md text-[10px] font-medium transition-colors ${
                  metric === k
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                }`}
              >
                {METRIC_LABELS[k]}
              </button>
            ))}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          {/* Body map */}
          <div className="flex justify-center">
            <MuscleBodyMap
              volumes={volumes}
              hoveredMuscle={hoveredMuscle}
              onHoverChange={handleHoverChange}
            />
          </div>

          {/* Breakdown */}
          <div className="space-y-2">
            {sorted.map(mg => {
              const data = volumes[mg];
              if (!data) return null;
              const pct = (data.total / maxTotal) * 100;
              const primaryPct = data.total > 0 ? (data.primary / data.total) * 100 : 100;
              const isHovered = hoveredMuscle === mg;
              const isDimmed = hoveredMuscle !== null && !isHovered;
              return (
                <div
                  key={mg}
                  className={`space-y-0.5 px-1.5 -mx-1.5 py-0.5 rounded cursor-pointer transition-all duration-150 ${
                    isHovered ? "bg-accent/20 scale-[1.02]" : isDimmed ? "opacity-30" : "hover:bg-accent/10"
                  }`}
                  onMouseEnter={() => setHoveredMuscle(mg)}
                  onMouseLeave={() => setHoveredMuscle(null)}
                >
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="w-2.5 h-2.5 rounded-sm transition-opacity"
                        style={{
                          backgroundColor: MUSCLE_COLORS[mg].hex,
                          opacity: isHovered ? 1 : isDimmed ? 0.3 : 0.8,
                        }}
                      />
                      <span className={`font-medium ${isHovered ? "text-foreground" : ""}`}>
                        {MUSCLE_LABELS[mg]}
                      </span>
                    </div>
                    <span className={isHovered ? "text-foreground font-medium" : "text-muted-foreground"}>
                      {formatVal(data.total)} {unit}
                    </span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden flex">
                    {/* Primary bar */}
                    <div
                      className="h-full rounded-full transition-opacity"
                      style={{
                        width: `${Math.max((pct * primaryPct) / 100, 2)}%`,
                        backgroundColor: MUSCLE_COLORS[mg].hex,
                        opacity: isHovered ? 1 : isDimmed ? 0.3 : 0.9,
                      }}
                    />
                    {/* Secondary bar (lighter) */}
                    {data.secondary > 0 && (
                      <div
                        className="h-full transition-opacity"
                        style={{
                          width: `${Math.max((pct * (100 - primaryPct)) / 100, 1)}%`,
                          backgroundColor: MUSCLE_COLORS[mg].hex,
                          opacity: isHovered ? 0.5 : isDimmed ? 0.1 : 0.35,
                        }}
                      />
                    )}
                  </div>
                </div>
              );
            })}
            <div className="flex items-center gap-4 mt-3 pt-2 border-t border-border/30 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="w-3 h-1.5 rounded-sm bg-emerald-500 opacity-90" /> Primary
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-1.5 rounded-sm bg-emerald-500 opacity-35" /> Secondary
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
