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
  ReferenceLine,
} from "recharts";
import { isLongRange, buildChartTicks, formatChartTick } from "@/lib/chart-utils";

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

  const nonZero = chartData.filter(d => d.weeklyAvg > 0);
  const avgHrv = nonZero.length > 0
    ? Math.round(nonZero.reduce((s, d) => s + d.weeklyAvg, 0) / nonZero.length)
    : null;

  const longRange = isLongRange(chartData);
  const tickDates = buildChartTicks(chartData);

  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
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
          domain={["auto", "auto"]}
        />
        {avgHrv !== null && (
          <ReferenceLine
            y={avgHrv}
            stroke="oklch(75% 0.17 160)"
            strokeDasharray="4 2"
            strokeOpacity={0.6}
            label={{ value: `avg ${avgHrv}ms`, position: "insideTopRight", fontSize: 9, fill: "oklch(75% 0.17 160)" }}
          />
        )}
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
          formatter={(value: any, name: any) => {
            const label = name === "nightly" ? "Last Night" : "Weekly Avg";
            return [`${value} ms`, label];
          }}
        />
        <Bar
          dataKey="nightly"
          fill="oklch(72% 0.17 160)"
          opacity={0.6}
          radius={[2, 2, 0, 0]}
        />
        <Line
          type="monotone"
          dataKey="weeklyAvg"
          stroke="oklch(82% 0.12 160)"
          strokeWidth={2}
          dot={false}
          strokeDasharray="5 5"
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
