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

  const spanDays = chartData.length > 1
    ? (new Date(chartData[chartData.length - 1].date).getTime() - new Date(chartData[0].date).getTime()) / 86400000
    : 0;
  const longRange = spanDays > 60;

  const tickDates = longRange ? (() => {
    const seen = new Set<string>();
    return chartData
      .filter((d) => {
        const key = new Date(d.date).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((d) => d.date);
  })() : undefined;

  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
          tickFormatter={(d: string) => {
            const date = new Date(d);
            return longRange
              ? date.toLocaleDateString("en-US", { month: "short", year: "2-digit" })
              : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          }}
          {...(tickDates ? { ticks: tickDates } : { interval: Math.max(Math.floor(chartData.length / 6), 1) })}
        />
        <YAxis
          className="text-[10px]"
          tickLine={false}
          domain={["auto", "auto"]}
        />
        <Tooltip
          contentStyle={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            fontSize: "12px",
            color: "var(--card-foreground)",
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
