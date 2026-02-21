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

  // Group by exercise for separate mini charts
  const byExercise = new Map<string, { date: string; weight: number }[]>();
  for (const row of data) {
    if (!byExercise.has(row.exercise)) byExercise.set(row.exercise, []);
    byExercise.get(row.exercise)!.push({
      date: String(row.workout_date),
      weight: Number(row.max_weight),
    });
  }

  const exercises = Array.from(byExercise.keys());

  return (
    <div className="space-y-4">
      {exercises.map((exercise) => {
        const points = byExercise.get(exercise)!.sort(
          (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
        );
        const latest = points[points.length - 1];
        const first = points[0];
        const change = latest.weight - first.weight;
        const color = COLORS[exercise] || "#888";
        const name = SHORT_NAMES[exercise] || exercise;

        return (
          <div key={exercise}>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-xs font-medium">{name}</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="font-bold">{latest.weight.toFixed(1)} kg</span>
                <span className={change >= 0 ? "text-green-400" : "text-red-400"}>
                  {change >= 0 ? "+" : ""}{change.toFixed(1)}
                </span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={60}>
              <LineChart data={points} margin={{ left: 0, right: 0, top: 2, bottom: 0 }}>
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
                      <div className="bg-card border border-border rounded-lg p-1.5 text-xs shadow-lg">
                        <div>{new Date(d.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })}</div>
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
    </div>
  );
}
