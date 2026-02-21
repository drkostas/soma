"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";

interface StepPoint {
  date: string;
  steps: number;
}

export function StepsTrendChart({ data, goal = 10000 }: { data: StepPoint[]; goal?: number }) {
  if (data.length === 0) return null;

  const recent = data.slice(-21);

  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={recent} margin={{ top: 5, right: 5, bottom: 5, left: -15 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
          tickFormatter={(d: string) => {
            const date = new Date(d);
            return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          }}
          interval={Math.max(Math.floor(recent.length / 7), 1)}
        />
        <YAxis
          tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
          tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)}
        />
        <Tooltip
          contentStyle={{
            background: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "8px",
            fontSize: "12px",
          }}
          labelFormatter={(d: any) =>
            new Date(String(d)).toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            })
          }
          formatter={(value: any) => [Number(value).toLocaleString(), "Steps"]}
        />
        <ReferenceLine y={goal} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" opacity={0.5} />
        <Bar
          dataKey="steps"
          radius={[2, 2, 0, 0]}
          fill="hsl(168, 70%, 45%)"
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
