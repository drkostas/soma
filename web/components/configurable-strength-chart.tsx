"use client";

import { useState, useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface ProgressEntry {
  exercise: string;
  workout_date: string;
  max_weight: number;
}

const PALETTE = [
  "#f97316", "#3b82f6", "#22c55e", "#a855f7", "#ef4444",
  "#14b8a6", "#f59e0b", "#ec4899", "#6366f1", "#84cc16",
  "#06b6d4", "#f43f5e", "#8b5cf6", "#10b981", "#e11d48",
];

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function ConfigurableStrengthChart({
  data,
  availableExercises,
  expanded,
}: {
  data: ProgressEntry[];
  availableExercises: { exercise: string; count: number }[];
  expanded?: boolean;
}) {
  const defaultSelected = useMemo(
    () => availableExercises.slice(0, 4).map(e => e.exercise),
    [availableExercises]
  );
  const [selected, setSelected] = useState<string[]>(defaultSelected);

  // Build exercise → color map
  const colorMap = useMemo(() => {
    const map: Record<string, string> = {};
    availableExercises.forEach((e, i) => {
      map[e.exercise] = PALETTE[i % PALETTE.length];
    });
    return map;
  }, [availableExercises]);

  // Group data by exercise
  const byExercise = useMemo(() => {
    const grouped = new Map<string, { date: string; weight: number }[]>();
    for (const row of data) {
      if (!selected.includes(row.exercise)) continue;
      if (!grouped.has(row.exercise)) grouped.set(row.exercise, []);
      grouped.get(row.exercise)!.push({
        date: String(row.workout_date),
        weight: Number(row.max_weight),
      });
    }
    return grouped;
  }, [data, selected]);

  const toggleExercise = (exercise: string) => {
    setSelected(prev =>
      prev.includes(exercise)
        ? prev.filter(e => e !== exercise)
        : [...prev, exercise]
    );
  };

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[300px] text-muted-foreground">
        No progression data yet.
      </div>
    );
  }

  // Show selector always when expanded, or toggle in compact mode
  const showSelector = expanded || false;
  const unselected = availableExercises.filter(e => !selected.includes(e.exercise));

  return (
    <div>
      {/* Selected exercise pills with click-to-remove */}
      <div className="flex flex-wrap gap-1 mb-3">
        {selected.map(ex => (
          <button
            key={ex}
            onClick={() => toggleExercise(ex)}
            className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors hover:opacity-70"
            style={{
              borderColor: colorMap[ex],
              color: colorMap[ex],
              backgroundColor: `${colorMap[ex]}15`,
            }}
            title="Click to remove"
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: colorMap[ex] }} />
            {ex.length > 30 ? ex.slice(0, 28) + "..." : ex}
            <span className="ml-0.5 text-[8px]">✕</span>
          </button>
        ))}
      </div>

      {/* Exercise selector - always shown when expanded */}
      {showSelector && unselected.length > 0 && (
        <div className="mb-3 max-h-48 overflow-y-auto border border-border/50 rounded-lg p-2 space-y-0.5 bg-card">
          <div className="text-[10px] text-muted-foreground mb-1 px-1">Click to add:</div>
          {unselected.map(ex => (
            <button
              key={ex.exercise}
              onClick={() => toggleExercise(ex.exercise)}
              className="w-full flex items-center justify-between px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-accent/10 transition-colors"
            >
              <div className="flex items-center gap-2 truncate">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: colorMap[ex.exercise] || "var(--muted)" }}
                />
                <span className="truncate">{ex.exercise}</span>
              </div>
              <span className="text-[10px] text-muted-foreground shrink-0 ml-2">
                {ex.count}x
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Compact mode: show + Add button */}
      {!expanded && unselected.length > 0 && (
        <div className="mb-3">
          <select
            className="w-full px-2 py-1.5 rounded-md text-xs border border-border/50 bg-card text-muted-foreground hover:text-foreground transition-colors"
            value=""
            onChange={(e) => {
              if (e.target.value) toggleExercise(e.target.value);
            }}
          >
            <option value="">+ Add exercise...</option>
            {unselected.map(ex => (
              <option key={ex.exercise} value={ex.exercise}>
                {ex.exercise} ({ex.count}x)
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Charts */}
      <div className="space-y-3">
        {Array.from(byExercise.entries()).map(([exercise, points]) => {
          const sorted = [...points].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
          const latest = sorted[sorted.length - 1];
          const first = sorted[0];
          const change = latest.weight - first.weight;
          const color = colorMap[exercise] || "#888";

          return (
            <div key={exercise}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                  <span className="text-xs font-medium truncate max-w-[250px]">{exercise}</span>
                </div>
                <div className="flex items-center gap-2 text-xs shrink-0">
                  <span className="font-bold">{latest.weight.toFixed(1)} kg</span>
                  <span className={change >= 0 ? "text-green-400" : "text-red-400"}>
                    {change >= 0 ? "+" : ""}{change.toFixed(1)}
                  </span>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={expanded ? 80 : 60}>
                <LineChart data={sorted} margin={{ left: 0, right: 0, top: 2, bottom: 0 }}>
                  <Line
                    type="monotone"
                    dataKey="weight"
                    stroke={color}
                    strokeWidth={1.5}
                    dot={false}
                    activeDot={{ r: 3 }}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.[0]) return null;
                      const d = payload[0].payload;
                      return (
                        <div className="bg-card text-card-foreground border border-border rounded-lg p-1.5 text-xs shadow-lg">
                          <div>{formatDate(d.date)}</div>
                          <div className="font-medium">{d.weight.toFixed(1)} kg</div>
                        </div>
                      );
                    }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          );
        })}
        {selected.length === 0 && (
          <div className="text-center text-muted-foreground text-sm py-8">
            Select exercises above to view progression
          </div>
        )}
      </div>
    </div>
  );
}
