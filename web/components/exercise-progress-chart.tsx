"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface ProgressEntry {
  exercise: string;
  workout_date: string;
  max_weight: number;
}

const COLORS: Record<string, string> = {
  "Bench Press (Barbell)": "#f97316",
  "Overhead Press (Barbell)": "#3b82f6",
  "Leg Press (Machine)": "#22c55e",
  "Iso-Lateral Row (Machine)": "#a855f7",
};

const SHORT_NAMES: Record<string, string> = {
  "Bench Press (Barbell)": "Bench",
  "Overhead Press (Barbell)": "OHP",
  "Leg Press (Machine)": "Leg Press",
  "Iso-Lateral Row (Machine)": "Row",
};

export function ExerciseProgressChart({ data }: { data: ProgressEntry[] }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[300px] text-muted-foreground">
        No progression data yet.
      </div>
    );
  }

  // Pivot data: merge all exercises into date-keyed rows
  const dateMap = new Map<string, Record<string, number>>();
  const exercises = new Set<string>();

  for (const row of data) {
    exercises.add(row.exercise);
    const key = String(row.workout_date);
    if (!dateMap.has(key)) {
      dateMap.set(key, {});
    }
    dateMap.get(key)![row.exercise] = Number(row.max_weight);
  }

  // Sort by date
  const sorted = Array.from(dateMap.entries())
    .sort(([a], [b]) => new Date(a).getTime() - new Date(b).getTime())
    .map(([date, values]) => ({ date, ...values }));

  const exerciseList = Array.from(exercises);

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={sorted}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis
          dataKey="date"
          className="text-xs"
          tickFormatter={(d) =>
            new Date(d).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })
          }
        />
        <YAxis
          className="text-xs"
          tickFormatter={(v) => `${v}kg`}
        />
        <Tooltip
          formatter={(value: any, name: any) => [
            typeof value === "number" ? `${value.toFixed(1)} kg` : "—",
            SHORT_NAMES[name] || name,
          ]}
          labelFormatter={(label) => new Date(label).toLocaleDateString()}
          contentStyle={{
            backgroundColor: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "8px",
            color: "hsl(var(--card-foreground))",
          }}
        />
        <Legend
          formatter={(value: string) => SHORT_NAMES[value] || value}
        />
        {exerciseList.map((ex) => (
          <Line
            key={ex}
            type="monotone"
            dataKey={ex}
            stroke={COLORS[ex] || "#888"}
            strokeWidth={2}
            dot={{ r: 2 }}
            activeDot={{ r: 4 }}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
