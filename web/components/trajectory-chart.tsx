"use client";

import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

interface TrajectoryEntry {
  date: string;
  optimal: number;
  actual: number | null;
}

interface TrajectoryChartProps {
  data: TrajectoryEntry[];
  raceDate: string;
  today: string;
  goalVdot: number;
}

export function TrajectoryChart({ data, raceDate, today, goalVdot }: TrajectoryChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[200px] text-muted-foreground text-sm">
        No trajectory data yet
      </div>
    );
  }

  const chartData = data.map((d) => ({
    date: d.date,
    optimal: Number(d.optimal.toFixed(1)),
    actual: d.actual !== null ? Number(Number(d.actual).toFixed(1)) : null,
  }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
          tickLine={false}
          tickFormatter={(d: string) => {
            const dt = new Date(d + "T00:00:00");
            return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          }}
          interval={Math.max(Math.floor(chartData.length / 7), 1)}
        />
        <YAxis
          className="text-[10px]"
          tickLine={false}
          domain={[46, 53]}
          label={{ value: "VDOT", angle: -90, position: "insideLeft", fontSize: 10, fill: "var(--muted-foreground)" }}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            fontSize: "12px",
            color: "var(--card-foreground)",
          }}
          formatter={(value: any, name: any) => {
            const labels: Record<string, string> = {
              optimal: "Target",
              actual: "Actual",
            };
            return [value, labels[name] || name];
          }}
        />
        <ReferenceLine
          x={today}
          stroke="var(--primary)"
          strokeDasharray="3 3"
          strokeOpacity={0.6}
          label={{ value: "Today", position: "top", fontSize: 9, fill: "var(--primary)" }}
        />
        <ReferenceLine
          x={raceDate}
          stroke="oklch(60% 0.2 300)"
          strokeDasharray="3 3"
          strokeOpacity={0.6}
          label={{ value: "Race", position: "top", fontSize: 9, fill: "oklch(60% 0.2 300)" }}
        />
        <ReferenceLine y={52} stroke="oklch(62% 0.17 142)" strokeDasharray="2 4" strokeOpacity={0.4}
          label={{ value: "A (1:35)", position: "right", fontSize: 8, fill: "oklch(62% 0.17 142)" }} />
        <ReferenceLine y={49} stroke="oklch(65% 0.15 250)" strokeDasharray="2 4" strokeOpacity={0.4}
          label={{ value: "B (1:40)", position: "right", fontSize: 8, fill: "oklch(65% 0.15 250)" }} />
        <ReferenceLine y={47.5} stroke="oklch(80% 0.18 87)" strokeDasharray="2 4" strokeOpacity={0.4}
          label={{ value: "C (1:43)", position: "right", fontSize: 8, fill: "oklch(80% 0.18 87)" }} />
        <Line
          type="monotone"
          dataKey="optimal"
          stroke="oklch(65% 0.15 250)"
          strokeWidth={2}
          strokeDasharray="6 3"
          dot={false}
          name="optimal"
        />
        <Line
          type="monotone"
          dataKey="actual"
          stroke="oklch(62% 0.17 142)"
          strokeWidth={2.5}
          dot={{ r: 3, fill: "oklch(62% 0.17 142)" }}
          connectNulls
          name="actual"
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
