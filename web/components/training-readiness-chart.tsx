"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
  ReferenceLine,
} from "recharts";
import { isLongRange, buildChartTicks, formatChartTick } from "@/lib/chart-utils";

interface ReadinessDataPoint {
  date: string;
  score: number;
  level: string;
}

function scoreColor(score: number): string {
  if (score >= 70) return "oklch(62% 0.17 142)"; // green
  if (score >= 40) return "oklch(80% 0.18 87)";  // yellow
  return "oklch(60% 0.22 25)";                    // red
}

export function TrainingReadinessChart({ data }: { data: ReadinessDataPoint[] }) {
  if (data.length === 0) return null;

  const chartData = data.slice(-30).map((d) => ({
    date: d.date,
    score: Number(d.score),
    level: d.level,
  }));

  const longRange = isLongRange(chartData);
  const tickDates = buildChartTicks(chartData);

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
          tickFormatter={(d: string) => formatChartTick(d, longRange)}
          {...(tickDates ? { ticks: tickDates } : { interval: Math.max(Math.floor(chartData.length / 6), 1) })}
        />
        <YAxis
          className="text-[10px]"
          tickLine={false}
          domain={[0, 100]}
        />
        <Tooltip
          cursor={{ fill: "var(--muted)", opacity: 0.3 }}
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
          formatter={(value: any, _name: any, item: any) => [
            `${value} (${item.payload.level?.toLowerCase() || ""})`,
            "Score",
          ]}
        />
        <ReferenceLine
          y={70}
          stroke="oklch(62% 0.17 142)"
          strokeDasharray="3 3"
          strokeOpacity={0.5}
          label={{ value: "Ready", position: "insideTopRight", fontSize: 9, fill: "oklch(62% 0.17 142)" }}
        />
        <ReferenceLine
          y={40}
          stroke="oklch(80% 0.18 87)"
          strokeDasharray="3 3"
          strokeOpacity={0.5}
          label={{ value: "Moderate", position: "insideTopRight", fontSize: 9, fill: "oklch(80% 0.18 87)" }}
        />
        <Bar dataKey="score" radius={[3, 3, 0, 0]}>
          {chartData.map((entry, index) => (
            <Cell key={index} fill={scoreColor(entry.score)} opacity={0.7} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
