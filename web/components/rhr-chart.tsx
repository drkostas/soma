"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { isLongRange, buildChartTicks, formatChartTick } from "@/lib/chart-utils";

interface RHREntry {
  date: string;
  rhr: number;
}

export function RHRChart({ data }: { data: RHREntry[] }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[200px] text-muted-foreground text-sm">
        No RHR data
      </div>
    );
  }

  const chartData = data.map((d) => ({
    date: d.date,
    rhr: Number(d.rhr),
  }));

  const avgRhr = chartData.length > 0
    ? Math.round(chartData.reduce((s, d) => s + d.rhr, 0) / chartData.length)
    : null;

  const longRange = isLongRange(chartData);
  const tickDates = buildChartTicks(chartData);

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis
          dataKey="date"
          className="text-[10px]"
          tickLine={false}
          tickFormatter={(d) => formatChartTick(d, longRange)}
          {...(tickDates ? { ticks: tickDates } : { interval: Math.max(Math.floor(chartData.length / 6), 1) })}
        />
        <YAxis className="text-xs" domain={["dataMin - 2", "dataMax + 2"]} />
        {avgRhr !== null && (
          <ReferenceLine
            y={avgRhr}
            stroke="oklch(60% 0.22 25)"
            strokeDasharray="4 2"
            strokeOpacity={0.5}
            label={{ value: `avg ${avgRhr}`, position: "insideTopRight", fontSize: 9, fill: "oklch(60% 0.22 25)" }}
          />
        )}
        <Tooltip
          formatter={(value: any) => [`${value} bpm`, "Resting HR"]}
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
        <Line
          type="monotone"
          dataKey="rhr"
          stroke="oklch(68% 0.19 25)"
          strokeWidth={2}
          dot={{ r: 3 }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
