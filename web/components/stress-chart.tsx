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

interface StressPoint {
  date: string;
  avg_stress: number;
  max_stress: number;
}

export function StressChart({ data }: { data: StressPoint[] }) {
  if (data.length === 0) return null;

  const chartData = data.slice(-30).map((d) => ({
    date: d.date,
    avg: Number(d.avg_stress),
    max: Number(d.max_stress),
  }));

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
        <defs>
          <linearGradient id="stressGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(48, 96%, 53%)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="hsl(48, 96%, 53%)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
        <XAxis
          dataKey="date"
          className="text-[10px]"
          tickLine={false}
          tickFormatter={(d: string) => {
            const date = new Date(d);
            return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          }}
          interval={Math.max(Math.floor(chartData.length / 5), 1)}
        />
        <YAxis
          className="text-[10px]"
          tickLine={false}
          domain={[0, 100]}
          width={30}
        />
        <Tooltip
          contentStyle={{
            background: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "8px",
            fontSize: "12px",
          }}
          labelFormatter={(d) =>
            new Date(String(d)).toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            })
          }
          formatter={(value: any, name: any) => {
            const label = name === "avg" ? "Average" : "Peak";
            return [value, label];
          }}
        />
        <Area
          type="monotone"
          dataKey="max"
          stroke="hsl(0, 70%, 55%)"
          fill="none"
          strokeWidth={1}
          strokeDasharray="3 3"
          opacity={0.5}
          dot={false}
        />
        <Area
          type="monotone"
          dataKey="avg"
          stroke="hsl(48, 96%, 53%)"
          fill="url(#stressGrad)"
          strokeWidth={2}
          dot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
