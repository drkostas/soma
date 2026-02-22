"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Loader2,
  Wrench,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface Outlier {
  date: string;
  weight: number;
  reps: number;
  workoutId: string;
  workoutTitle: string;
  exerciseIndex: number;
  setIndex: number;
  localMedianWt: number | null;
  flag: string; // "weight_high" | "weight_low" | "reps_high"
  reason: string;
  suggestedValue: number | null;
  globalMedianReps: number;
}

interface ExerciseData {
  name: string;
  chartData: Array<{
    date: string;
    weight: number;
    reps: number;
    workoutId: string;
    exerciseIndex: number;
    setIndex: number;
  }>;
  outliers: Outlier[];
}

interface OutlierInspectorProps {
  outlier: Outlier;
  exercise: ExerciseData;
  fixedSets: Set<string>;
  onFix: (outlier: Outlier, value: number) => Promise<void>;
  onSkip: () => void;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function outlierKey(o: Outlier): string {
  return `${o.workoutId}-${o.exerciseIndex}-${o.setIndex}`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "2-digit" }),
  });
}

function flagLabel(flag: string): string {
  switch (flag) {
    case "weight_high":
      return "Weight High";
    case "weight_low":
      return "Weight Low";
    case "reps_high":
      return "Reps High";
    default:
      return flag;
  }
}

/** Return the field affected by this flag. */
function flagField(flag: string): "weight" | "reps" {
  return flag.startsWith("reps") ? "reps" : "weight";
}

/** Find ~7 neighboring points around the outlier's date. */
function getNeighborhood(
  chartData: ExerciseData["chartData"],
  outlierDate: string,
  radius = 3,
) {
  const sorted = chartData
    .slice()
    .sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );

  // Find the index of the point closest to the outlier date
  const targetTime = new Date(outlierDate).getTime();
  let closestIdx = 0;
  let closestDist = Infinity;
  for (let i = 0; i < sorted.length; i++) {
    const dist = Math.abs(new Date(sorted[i].date).getTime() - targetTime);
    if (dist < closestDist) {
      closestDist = dist;
      closestIdx = i;
    }
  }

  const start = Math.max(0, closestIdx - radius);
  const end = Math.min(sorted.length, closestIdx + radius + 1);
  return sorted.slice(start, end);
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function OutlierInspector({
  outlier,
  exercise,
  fixedSets,
  onFix,
  onSkip,
}: OutlierInspectorProps) {
  const [fixing, setFixing] = useState(false);
  const [customValue, setCustomValue] = useState("");
  const [showRaw, setShowRaw] = useState(false);

  const field = flagField(outlier.flag);
  const unit = field === "weight" ? "kg" : "reps";
  const currentValue = field === "weight" ? outlier.weight : outlier.reps;
  const isFixed = fixedSets.has(outlierKey(outlier));

  const neighborhood = getNeighborhood(exercise.chartData, outlier.date);

  async function handleFix(value: number) {
    setFixing(true);
    try {
      await onFix(outlier, value);
    } finally {
      setFixing(false);
    }
  }

  function handleCustomFix() {
    const val = parseFloat(customValue);
    if (!isNaN(val) && val > 0) {
      handleFix(val);
    }
  }

  return (
    <Card className="border-destructive/30">
      {/* -- Header -- */}
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-sm font-medium">
              {formatDate(outlier.date)} &mdash; {outlier.workoutTitle}
            </CardTitle>
          </div>
          <Badge variant="destructive" className="shrink-0">
            <AlertTriangle className="size-3" />
            {flagLabel(outlier.flag)}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* -- Context box -- */}
        <div className="rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2.5 text-sm">
          <div className="font-medium text-destructive">
            Current: {currentValue} {unit}
          </div>
          <div className="mt-1 text-muted-foreground text-xs">
            {outlier.reason}
          </div>
        </div>

        {/* -- Neighborhood table -- */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="text-left py-1.5 pr-3 font-medium">Date</th>
                <th className="text-right py-1.5 px-3 font-medium">
                  Weight (kg)
                </th>
                <th className="text-right py-1.5 pl-3 font-medium">Reps</th>
              </tr>
            </thead>
            <tbody>
              {neighborhood.map((pt) => {
                const isOutlierRow =
                  pt.date === outlier.date &&
                  pt.workoutId === outlier.workoutId &&
                  pt.exerciseIndex === outlier.exerciseIndex &&
                  pt.setIndex === outlier.setIndex;
                return (
                  <tr
                    key={`${pt.workoutId}-${pt.exerciseIndex}-${pt.setIndex}`}
                    className={
                      isOutlierRow
                        ? "bg-destructive/10 font-bold text-destructive"
                        : "border-b border-border/50"
                    }
                  >
                    <td className="py-1.5 pr-3">{formatDate(pt.date)}</td>
                    <td className="text-right py-1.5 px-3">{pt.weight}</td>
                    <td className="text-right py-1.5 pl-3">{pt.reps}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* -- Actions or Fixed state -- */}
        {isFixed ? (
          <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
            <Check className="size-4" />
            <span className="font-medium">Fixed</span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {outlier.suggestedValue !== null && (
              <Button
                size="sm"
                disabled={fixing}
                onClick={() => handleFix(outlier.suggestedValue!)}
              >
                {fixing ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Wrench className="size-3.5" />
                )}
                Fix to {outlier.suggestedValue} {unit}
              </Button>
            )}

            <div className="flex items-center gap-1">
              <input
                type="number"
                placeholder={unit}
                value={customValue}
                onChange={(e) => setCustomValue(e.target.value)}
                disabled={fixing}
                className="h-8 w-20 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-ring focus:ring-ring/50 focus:ring-[3px] disabled:opacity-50"
              />
              <Button
                size="sm"
                variant="secondary"
                disabled={fixing || !customValue}
                onClick={handleCustomFix}
              >
                Custom
              </Button>
            </div>

            <Button
              size="sm"
              variant="outline"
              disabled={fixing}
              onClick={onSkip}
            >
              Skip
            </Button>
          </div>
        )}

        {/* -- Raw data toggle -- */}
        <div>
          <button
            type="button"
            onClick={() => setShowRaw((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronDown
              className={`size-3.5 transition-transform ${showRaw ? "rotate-0" : "-rotate-90"}`}
            />
            Raw data
          </button>
          {showRaw && (
            <pre className="mt-2 rounded-md bg-muted p-3 text-xs overflow-x-auto">
              <code>{JSON.stringify(outlier, null, 2)}</code>
            </pre>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
