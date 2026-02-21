"use client";

import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

interface HRVDataPoint {
  date: string;
  weekly_avg: number;
  last_night_avg: number;
  status: string;
}

export function HRVChart({ data }: { data: HRVDataPoint[] }) {
  if (data.length === 0) return null;

  const chartData = data.slice(-30).map((d) => ({
    date: d.date,
    nightly: Number(d.last_night_avg) || 0,
    weeklyAvg: Number(d.weekly_avg) || 0,
    status: d.status,
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
          tickFormatter={(d: string) => {
            const date = new Date(d);
            return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          }}
          interval={Math.max(Math.floor(chartData.length / 6), 1)}
        />
        <YAxis
          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
          domain={["auto", "auto"]}
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
            const label = name === "nightly" ? "Last Night" : "Weekly Avg";
            return [`${value} ms`, label];
          }}
        />
        <Bar
          dataKey="nightly"
          fill="hsl(160, 80%, 55%)"
          opacity={0.6}
          radius={[2, 2, 0, 0]}
        />
        <Line
          type="monotone"
          dataKey="weeklyAvg"
          stroke="hsl(160, 80%, 75%)"
          strokeWidth={2}
          dot={false}
          strokeDasharray="5 5"
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
