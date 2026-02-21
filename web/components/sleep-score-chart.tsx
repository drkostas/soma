"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

interface ScoreEntry {
  date: string;
  score: number;
}

function getScoreColor(score: number) {
  if (score >= 80) return "text-green-400";
  if (score >= 60) return "text-yellow-400";
  return "text-red-400";
}

export function SleepScoreChart({ data }: { data: ScoreEntry[] }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[200px] text-muted-foreground text-sm">
        No score data
      </div>
    );
  }

  const chartData = data.map((d) => ({
    date: d.date,
    score: Number(d.score),
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
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
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
          {...(tickDates ? { ticks: tickDates } : { interval: Math.max(Math.floor(chartData.length / 6), 1) })}
        />
        <YAxis className="text-xs" domain={[0, 100]} />
        <ReferenceLine y={80} stroke="var(--muted-foreground)" strokeDasharray="3 3" />
        <Tooltip
          formatter={(value: any) => [`${value}`, "Sleep Score"]}
          labelFormatter={(label) =>
            new Date(label).toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            })
          }
          contentStyle={{
            backgroundColor: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            color: "var(--card-foreground)",
          }}
        />
        <Area
          type="monotone"
          dataKey="score"
          stroke="#818cf8"
          fill="#818cf8"
          fillOpacity={0.2}
          strokeWidth={2}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
