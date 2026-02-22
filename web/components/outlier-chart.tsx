"use client";

import { useState, useCallback } from "react";
import {
  ComposedChart,
  Scatter,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardAction,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface SetPoint {
  date: string;
  weight: number;
  reps: number;
  workoutId: string;
  workoutTitle: string;
  exerciseIndex: number;
  setIndex: number;
  localMedianWt: number | null;
  isOutlier: boolean;
}

interface ExerciseData {
  name: string;
  chartData: SetPoint[];
  outliers: any[];
}

interface OutlierChartProps {
  exercise: ExerciseData;
  fixedSets: Set<string>;
  onPointClick: (point: SetPoint) => void;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function setKey(p: SetPoint): string {
  return `${p.workoutId}-${p.exerciseIndex}-${p.setIndex}`;
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    month: "short",
    year: "2-digit",
  });
}

/** Subsample indices down to ~maxTicks unique, evenly spaced ticks. */
function buildTicks(
  data: { date: string }[],
  maxTicks: number,
): number[] {
  if (data.length <= maxTicks) {
    return data.map((_, i) => i);
  }
  const step = Math.max(1, Math.floor((data.length - 1) / (maxTicks - 1)));
  const ticks: number[] = [];
  for (let i = 0; i < data.length; i += step) {
    ticks.push(i);
  }
  // Always include the last index
  if (ticks[ticks.length - 1] !== data.length - 1) {
    ticks.push(data.length - 1);
  }
  return ticks;
}

/* ------------------------------------------------------------------ */
/* Custom tooltip                                                      */
/* ------------------------------------------------------------------ */

function ChartTooltip({ active, payload }: any) {
  if (!active || !payload?.[0]) return null;
  const p: SetPoint = payload[0].payload;
  const dateStr = new Date(p.date).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return (
    <div
      className="rounded-lg p-2.5 text-xs shadow-lg"
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        color: "var(--card-foreground)",
      }}
    >
      <div className="font-medium mb-1">{p.workoutTitle}</div>
      <div className="text-muted-foreground mb-1">{dateStr}</div>
      <div>
        {p.weight} kg &times; {p.reps} reps
      </div>
      {p.isOutlier && (
        <div className="mt-1 text-destructive font-medium">
          Flagged as outlier
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Legend                                                               */
/* ------------------------------------------------------------------ */

function DotLegend() {
  const items = [
    { label: "Normal", color: "var(--primary)" },
    { label: "Outlier", color: "hsl(0 84% 60%)" },
    { label: "Fixed", color: "var(--muted-foreground)", opacity: 0.3 },
  ];
  return (
    <div className="flex items-center justify-center gap-4 mt-2 text-xs text-muted-foreground">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full"
            style={{
              backgroundColor: it.color,
              opacity: it.opacity ?? 1,
            }}
          />
          {it.label}
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

export function OutlierChart({
  exercise,
  fixedSets,
  onPointClick,
}: OutlierChartProps) {
  const [mode, setMode] = useState<"weight" | "reps">("weight");

  const sorted = exercise.chartData
    .slice()
    .sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );

  // Enrich with numeric index for XAxis
  const indexed = sorted.map((p, i) => ({ ...p, idx: i }));

  const ticks = buildTicks(sorted, 10);

  const handleClick = useCallback(
    (_: any, __: any, e: any) => {
      // Recharts Scatter onClick gives (entry, index, event)
      // But the shape of args varies; we handle both patterns.
      const point = _ as SetPoint | undefined;
      if (point && point.workoutId) {
        onPointClick(point);
      }
    },
    [onPointClick],
  );

  if (sorted.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">
            {exercise.name}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-[300px] text-muted-foreground text-sm">
            No set data available.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">
          {exercise.name}
        </CardTitle>
        <CardAction>
          <div className="flex gap-1">
            <Button
              variant={mode === "weight" ? "default" : "outline"}
              size="xs"
              onClick={() => setMode("weight")}
            >
              Weight
            </Button>
            <Button
              variant={mode === "reps" ? "default" : "outline"}
              size="xs"
              onClick={() => setMode("reps")}
            >
              Reps
            </Button>
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart
            data={indexed}
            margin={{ top: 10, right: 20, bottom: 5, left: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--border)"
            />
            <XAxis
              dataKey="idx"
              type="number"
              domain={[0, indexed.length - 1]}
              ticks={ticks}
              tickLine={false}
              className="text-[10px]"
              tickFormatter={(i: number) => {
                const pt = indexed[i];
                return pt ? formatDateLabel(pt.date) : "";
              }}
            />
            <YAxis
              className="text-xs"
              label={{
                value: mode === "weight" ? "kg" : "reps",
                angle: -90,
                position: "insideLeft",
                style: {
                  fill: "var(--muted-foreground)",
                  fontSize: 11,
                },
              }}
            />
            <Tooltip content={<ChartTooltip />} />
            <Scatter
              dataKey={mode}
              onClick={handleClick}
              cursor="pointer"
            >
              {indexed.map((p) => {
                const fixed = fixedSets.has(setKey(p));
                const outlier = p.isOutlier && !fixed;
                return (
                  <Cell
                    key={`${p.workoutId}-${p.exerciseIndex}-${p.setIndex}`}
                    fill={
                      fixed
                        ? "var(--muted-foreground)"
                        : outlier
                          ? "hsl(0 84% 60%)"
                          : "var(--primary)"
                    }
                    fillOpacity={fixed ? 0.3 : 1}
                    r={outlier ? 5 : 3}
                  />
                );
              })}
            </Scatter>
          </ComposedChart>
        </ResponsiveContainer>
        <DotLegend />
      </CardContent>
    </Card>
  );
}
