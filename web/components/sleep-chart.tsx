"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface SleepEntry {
  date: string;
  deep: number;
  light: number;
  rem: number;
  awake: number;
}

export function SleepStagesChart({ data }: { data: SleepEntry[] }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[300px] text-muted-foreground text-sm">
        No sleep data
      </div>
    );
  }

  const chartData = data.map((d) => ({
    date: d.date,
    Deep: Number((d.deep / 3600).toFixed(1)),
    Light: Number((d.light / 3600).toFixed(1)),
    REM: Number((d.rem / 3600).toFixed(1)),
    Awake: Number((d.awake / 3600).toFixed(1)),
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
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={chartData}>
        <XAxis
          dataKey="date"
          className="text-[10px]"
          tickLine={false}
          tickFormatter={(d) => {
            const date = new Date(d);
            return longRange
              ? date.toLocaleDateString("en-US", { month: "short", year: "2-digit" })
              : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          }}
          tick={{ fontSize: 10 }}
          {...(tickDates ? { ticks: tickDates } : { interval: Math.max(Math.floor(chartData.length / 6), 1) })}
        />
        <YAxis
          className="text-xs"
          tickFormatter={(v) => `${v}h`}
          tick={{ fontSize: 10 }}
        />
        <Tooltip
          formatter={(value: any, name: any) => [`${value}h`, name]}
          labelFormatter={(label) =>
            new Date(label).toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            })
          }
          contentStyle={{
            backgroundColor: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "8px",
            color: "hsl(var(--card-foreground))",
          }}
        />
        <Legend />
        <Bar dataKey="Deep" stackId="sleep" fill="#6366f1" radius={[0, 0, 0, 0]} />
        <Bar dataKey="Light" stackId="sleep" fill="#818cf8" radius={[0, 0, 0, 0]} />
        <Bar dataKey="REM" stackId="sleep" fill="#a78bfa" radius={[0, 0, 0, 0]} />
        <Bar dataKey="Awake" stackId="sleep" fill="#f87171" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
