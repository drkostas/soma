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
import { getExerciseMuscles, MUSCLE_LABELS, MUSCLE_COLORS, ALL_MUSCLE_GROUPS, type MuscleGroup } from "@/lib/muscle-groups";

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

function MuscleGroupTrendView({
  muscle,
  data,
  onBack,
}: {
  muscle: MuscleGroup;
  data: ExerciseHrDetailPoint[];
  onBack: () => void;
}) {
  const points = useMemo(() => {
    // Group by workout date, average HR for workouts that hit this muscle group
    const byDate = new Map<string, { totalHr: number; count: number; maxHr: number }>();

    for (const row of data) {
      const mapping = getExerciseMuscles(row.exercise);
      if (!mapping.primary.includes(muscle)) continue;
      const date = String(row.workout_date).slice(0, 10);
      const hr = Number(row.avg_hr);
      const maxHr = Number(row.max_hr);
      if (!hr || isNaN(hr)) continue;

      if (!byDate.has(date)) byDate.set(date, { totalHr: 0, count: 0, maxHr: 0 });
      const acc = byDate.get(date)!;
      acc.totalHr += hr;
      acc.count++;
      if (maxHr > acc.maxHr) acc.maxHr = maxHr;
    }

    return Array.from(byDate.entries())
      .map(([date, v]) => ({
        date,
        avg_hr: Math.round(v.totalHr / v.count),
        max_hr: Math.round(v.maxHr),
      }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [data, muscle]);

  if (points.length === 0) {
    return (
      <div className="text-center text-muted-foreground text-sm py-8">
        No HR trend data for this muscle group
      </div>
    );
  }

  const color = MUSCLE_COLORS[muscle].hex;
  const label = MUSCLE_LABELS[muscle];
  const avgHr = Math.round(points.reduce((s, p) => s + p.avg_hr, 0) / points.length);
  const minHr = Math.min(...points.map(p => p.avg_hr));
  const maxHr = Math.max(...points.map(p => p.avg_hr));
  const yMin = Math.floor(minHr / 10) * 10 - 5;
  const yMax = Math.ceil(maxHr / 10) * 10 + 5;
  const first = points[0].avg_hr;
  const last = points[points.length - 1].avg_hr;
  const trend = last - first;

  return (
    <div>
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-2 transition-colors"
      >
        <ChevronLeft className="h-3 w-3" />
        Back to all muscle groups
      </button>
      <div className="flex items-center gap-2 mb-1">
        <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: color }} />
        <span className="font-medium text-sm">{label}</span>
      </div>
      <div className="flex items-center gap-4 mb-3 text-xs text-muted-foreground">
        <span>Avg: <strong className="text-foreground">{avgHr} bpm</strong></span>
        <span>Range: {Math.round(minHr)}–{Math.round(maxHr)} bpm</span>
        <span className={trend > 0 ? "text-red-400" : trend < 0 ? "text-green-400" : ""}>
          {trend > 0 ? "+" : ""}{trend.toFixed(0)} bpm trend
        </span>
        <span>{points.length} workouts</span>
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
                    <div className="flex items-center gap-1" style={{ color }}>
                      <Heart className="h-3 w-3" /> Avg: {d.avg_hr} bpm
                    </div>
                    <div>Max: {d.max_hr} bpm</div>
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
            stroke={color}
            strokeWidth={2}
            dot={{ r: 3, fill: color }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MuscleGroupHrChart({ data }: { data: ExerciseHrDetailPoint[] }) {
  const [selectedMuscle, setSelectedMuscle] = useState<MuscleGroup | null>(null);

  const muscleHr = useMemo(() => {
    const acc: Record<string, { totalHr: number; count: number; maxHr: number }> = {};

    for (const row of data) {
      const mapping = getExerciseMuscles(row.exercise);
      const hr = Number(row.avg_hr);
      const maxHr = Number(row.max_hr);
      if (!hr || isNaN(hr)) continue;

      for (const mg of mapping.primary) {
        if (!acc[mg]) acc[mg] = { totalHr: 0, count: 0, maxHr: 0 };
        acc[mg].totalHr += hr;
        acc[mg].count++;
        if (maxHr > acc[mg].maxHr) acc[mg].maxHr = maxHr;
      }
    }

    return ALL_MUSCLE_GROUPS
      .filter(mg => acc[mg]?.count > 0)
      .map(mg => ({
        muscle: mg,
        label: MUSCLE_LABELS[mg],
        color: MUSCLE_COLORS[mg].hex,
        avg_hr: Math.round(acc[mg].totalHr / acc[mg].count),
        max_hr: Math.round(acc[mg].maxHr),
        sessions: acc[mg].count,
      }))
      .sort((a, b) => b.avg_hr - a.avg_hr);
  }, [data]);

  if (muscleHr.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[250px] text-muted-foreground gap-2">
        <Heart className="h-6 w-6 opacity-30" />
        <span className="text-sm">No muscle group HR data</span>
      </div>
    );
  }

  if (selectedMuscle) {
    return (
      <MuscleGroupTrendView
        muscle={selectedMuscle}
        data={data}
        onBack={() => setSelectedMuscle(null)}
      />
    );
  }

  const maxHr = muscleHr[0].avg_hr;
  const minHr = muscleHr[muscleHr.length - 1].avg_hr;
  const range = maxHr - minHr || 1;

  return (
    <div className="space-y-2">
      <div className="text-[10px] text-muted-foreground mb-2">
        Click a muscle group to see its HR trend over time
      </div>
      {muscleHr.map((mg) => {
        const pct = ((mg.avg_hr - minHr) / range) * 70 + 30;
        return (
          <div
            key={mg.muscle}
            className="space-y-0.5 cursor-pointer hover:bg-accent/20 -mx-1.5 px-1.5 py-0.5 rounded transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedMuscle(mg.muscle);
            }}
          >
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5">
                <span
                  className="w-2.5 h-2.5 rounded-sm"
                  style={{ backgroundColor: mg.color, opacity: 0.8 }}
                />
                <span className="font-medium">{mg.label}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0 text-muted-foreground">
                <span className="font-medium text-foreground">{mg.avg_hr} bpm</span>
                <span className="text-[10px]">{mg.sessions}x</span>
              </div>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(pct, 5)}%`,
                  backgroundColor: mg.color,
                  opacity: 0.7,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
