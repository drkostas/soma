"use client";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { isLongRange, buildChartTicks, formatChartTick } from "@/lib/chart-utils";

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

  const longRange = isLongRange(chartData);
  const tickDates = buildChartTicks(chartData);

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
        <defs>
          <linearGradient id="stressGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="oklch(85% 0.18 90)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="oklch(85% 0.18 90)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
        <XAxis
          dataKey="date"
          className="text-[10px]"
          tickLine={false}
          tickFormatter={(d: string) => formatChartTick(d, longRange)}
          {...(tickDates ? { ticks: tickDates } : { interval: Math.max(Math.floor(chartData.length / 5), 1) })}
        />
        <YAxis
          className="text-[10px]"
          tickLine={false}
          domain={[0, 100]}
          width={30}
        />
        <ReferenceLine
          y={25}
          stroke="oklch(65% 0.18 220)"
          strokeDasharray="3 3"
          strokeOpacity={0.4}
          label={{ value: "low", position: "insideTopRight", fontSize: 8, fill: "oklch(65% 0.18 220)" }}
        />
        <ReferenceLine
          y={50}
          stroke="oklch(80% 0.18 87)"
          strokeDasharray="3 3"
          strokeOpacity={0.5}
          label={{ value: "med", position: "insideTopRight", fontSize: 8, fill: "oklch(80% 0.18 87)" }}
        />
        <ReferenceLine
          y={75}
          stroke="oklch(60% 0.22 25)"
          strokeDasharray="3 3"
          strokeOpacity={0.5}
          label={{ value: "high", position: "insideTopRight", fontSize: 8, fill: "oklch(60% 0.22 25)" }}
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
            const label = name === "avg" ? "Average" : "Peak";
            return [value, label];
          }}
        />
        <Area
          type="monotone"
          dataKey="max"
          stroke="oklch(55% 0.20 25)"
          fill="none"
          strokeWidth={1}
          strokeDasharray="3 3"
          opacity={0.5}
          dot={false}
        />
        <Area
          type="monotone"
          dataKey="avg"
          stroke="oklch(85% 0.18 90)"
          fill="url(#stressGrad)"
          strokeWidth={2}
          dot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
