"use client";

import { useState, useMemo } from "react";
import { Heart, ChevronLeft } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

interface ExerciseHr {
  exercise: string;
  avg_hr: number;
  max_hr: number;
  session_count: number;
}

interface ExerciseHrDetailPoint {
  exercise: string;
  workout_date: string;
  avg_hr: number;
  max_hr: number;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function ExerciseTrendView({
  exercise,
  detail,
  onBack,
}: {
  exercise: string;
  detail: ExerciseHrDetailPoint[];
  onBack: () => void;
}) {
  const points = useMemo(() => {
    return detail
      .filter(d => d.exercise === exercise)
      .sort((a, b) => new Date(a.workout_date).getTime() - new Date(b.workout_date).getTime())
      .map(d => ({
        date: String(d.workout_date).slice(0, 10),
        avg_hr: Number(d.avg_hr),
        max_hr: Number(d.max_hr),
      }));
  }, [detail, exercise]);

  if (points.length === 0) {
    return (
      <div className="text-center text-muted-foreground text-sm py-8">
        No per-workout HR data for this exercise
      </div>
    );
  }

  const avgHr = Math.round(points.reduce((s, p) => s + p.avg_hr, 0) / points.length);
  const minHr = Math.min(...points.map(p => p.avg_hr));
  const maxHr = Math.max(...points.map(p => p.avg_hr));
  const yMin = Math.floor(minHr / 10) * 10 - 5;
  const yMax = Math.ceil(maxHr / 10) * 10 + 5;
  const first = points[0].avg_hr;
  const last = points[points.length - 1].avg_hr;
  const trend = last - first;

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-2 transition-colors"
      >
        <ChevronLeft className="h-3 w-3" />
        Back to all exercises
      </button>
      <div className="font-medium text-sm mb-1 truncate">{exercise}</div>
      <div className="flex items-center gap-4 mb-3 text-xs text-muted-foreground">
        <span>Avg: <strong className="text-foreground">{avgHr} bpm</strong></span>
        <span>Range: {Math.round(minHr)}–{Math.round(maxHr)} bpm</span>
        <span className={trend > 0 ? "text-red-400" : trend < 0 ? "text-green-400" : ""}>
          {trend > 0 ? "+" : ""}{trend.toFixed(0)} bpm trend
        </span>
        <span>{points.length} sessions</span>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={points} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} />
          <XAxis
            dataKey="date"
            tickFormatter={formatDate}
            className="text-[10px]"
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            domain={[yMin, yMax]}
            className="text-[10px]"
            tickLine={false}
            axisLine={false}
            width={40}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.[0]) return null;
              const d = payload[0].payload;
              return (
                <div className="bg-popover border border-border rounded-lg p-2 text-xs shadow-md">
                  <div className="font-medium">{formatDate(d.date)}</div>
                  <div className="mt-1 space-y-0.5">
                    <div className="flex items-center gap-1 text-red-400">
                      <Heart className="h-3 w-3" /> Avg: {Math.round(d.avg_hr)} bpm
                    </div>
                    <div>Max: {Math.round(d.max_hr)} bpm</div>
                  </div>
                </div>
              );
            }}
          />
          <ReferenceLine
            y={avgHr}
            stroke="var(--muted-foreground)"
            strokeDasharray="6 4"
            strokeOpacity={0.4}
          />
          <Line
            type="monotone"
            dataKey="avg_hr"
            stroke="#ef4444"
            strokeWidth={2}
            dot={{ r: 3, fill: "#ef4444" }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ExerciseHrChart({
  data,
  detail,
}: {
  data: ExerciseHr[];
  detail?: ExerciseHrDetailPoint[];
}) {
  const [selectedExercise, setSelectedExercise] = useState<string | null>(null);

  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[250px] text-muted-foreground gap-2">
        <Heart className="h-6 w-6 opacity-30" />
        <span className="text-sm">No per-exercise HR data</span>
      </div>
    );
  }

  if (selectedExercise && detail) {
    return (
      <ExerciseTrendView
        exercise={selectedExercise}
        detail={detail}
        onBack={() => setSelectedExercise(null)}
      />
    );
  }

  const sorted = [...data].sort((a, b) => b.avg_hr - a.avg_hr);
  const maxHr = Math.max(...sorted.map(d => d.avg_hr));
  const minHr = Math.min(...sorted.map(d => d.avg_hr));
  const range = maxHr - minHr || 1;

  return (
    <div className="space-y-1.5 max-h-[320px] overflow-y-auto">
      {detail && (
        <div className="text-[10px] text-muted-foreground mb-2 sticky top-0 bg-card pb-1 z-10">Click an exercise to see its HR trend over time</div>
      )}
      {sorted.map((ex) => {
        const pct = ((ex.avg_hr - minHr) / range) * 70 + 30;
        const intensity = (ex.avg_hr - minHr) / range;
        const hue = 0 + (1 - intensity) * 220;
        return (
          <div
            key={ex.exercise}
            className={`space-y-0.5 ${detail ? "cursor-pointer hover:bg-accent/20 -mx-1.5 px-1.5 py-0.5 rounded transition-colors" : ""}`}
            onClick={(e) => {
              if (detail) {
                e.stopPropagation();
                setSelectedExercise(ex.exercise);
              }
            }}
          >
            <div className="flex items-center justify-between text-xs">
              <span className="truncate mr-2 max-w-[200px]">{ex.exercise}</span>
              <div className="flex items-center gap-2 shrink-0 text-muted-foreground">
                <span className="font-medium text-foreground">{Math.round(ex.avg_hr)} bpm</span>
                <span className="text-[10px]">{ex.session_count}x</span>
              </div>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.max(pct, 5)}%`,
                  backgroundColor: `hsl(${hue}, 70%, 50%)`,
                  opacity: 0.8,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
