"use client";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

interface CaloriePoint {
  date: string;
  active: number;
  bmr: number;
}

export function CalorieTrendChart({ data }: { data: CaloriePoint[] }) {
  if (data.length === 0) return null;

  const recent = data.slice(-21);

  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={recent} margin={{ top: 5, right: 5, bottom: 5, left: -15 }}>
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
          tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)}
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
          formatter={(value: any, name: any) => {
            const label = name === "active" ? "Active" : "BMR";
            return [`${Number(value).toLocaleString()} kcal`, label];
          }}
        />
        <Area
          type="monotone"
          dataKey="bmr"
          stackId="1"
          stroke="hsl(var(--muted-foreground))"
          fill="hsl(var(--muted))"
          fillOpacity={0.3}
          strokeWidth={0}
        />
        <Area
          type="monotone"
          dataKey="active"
          stackId="1"
          stroke="hsl(25, 80%, 55%)"
          fill="hsl(25, 80%, 55%)"
          fillOpacity={0.4}
          strokeWidth={1.5}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
