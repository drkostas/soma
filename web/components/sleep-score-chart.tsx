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
import { isLongRange, buildChartTicks, formatChartTick } from "@/lib/chart-utils";

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

  const longRange = isLongRange(chartData);
  const tickDates = buildChartTicks(chartData);

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis
          dataKey="date"
          className="text-[10px]"
          tickLine={false}
          tickFormatter={(d) => formatChartTick(d, longRange)}
          {...(tickDates ? { ticks: tickDates } : { interval: Math.max(Math.floor(chartData.length / 6), 1) })}
        />
        <YAxis className="text-xs" domain={[0, 100]} />
        <ReferenceLine y={80} stroke="var(--muted-foreground)" strokeDasharray="3 3" label={{ value: "Good", position: "insideTopRight", fontSize: 9, fill: "var(--muted-foreground)" }} />
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
          stroke="oklch(65% 0.18 270)"
          fill="oklch(65% 0.18 270)"
          fillOpacity={0.2}
          strokeWidth={2}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
