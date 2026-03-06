"use client";

import {
  ComposedChart,
  Bar,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { isLongRange, buildChartTicks, formatChartTick } from "@/lib/chart-utils";

interface VolumeEntry {
  week: string;
  total_volume: number;
}

export function VolumeChart({ data }: { data: VolumeEntry[] }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[300px] text-muted-foreground">
        No volume data yet.
      </div>
    );
  }

  const chartData = data.map((d) => ({
    week: d.week,
    volume: Number(d.total_volume),
  }));

  const enriched = chartData.map((d, i) => {
    const window = chartData.slice(Math.max(0, i - 3), i + 1);
    const avg = window.reduce((s, w) => s + w.volume, 0) / window.length;
    return { ...d, avg: Math.round(avg) };
  });

  const overallAvg = Math.round(
    chartData.reduce((s, d) => s + d.volume, 0) / chartData.length
  );

  const weekAsDate = chartData.map((d) => ({ date: d.week }));
  const longRange = isLongRange(weekAsDate);
  const tickDates = buildChartTicks(weekAsDate);

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={enriched}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis
          dataKey="week"
          className="text-[10px]"
          tickLine={false}
          tickFormatter={(d) => formatChartTick(d, longRange)}
          {...(tickDates ? { ticks: tickDates } : { interval: Math.max(0, Math.floor(chartData.length / 6)) })}
        />
        <YAxis
          className="text-xs"
          tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
        />
        <Tooltip
          cursor={{ fill: "var(--muted)", opacity: 0.3 }}
          formatter={(value: any, name?: string) => [
            `${Number(value).toLocaleString()} kg`,
            name === "avg" ? "4-week avg" : "Volume",
          ]}
          labelFormatter={(label) =>
            `Week of ${new Date(label).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}`
          }
          contentStyle={{
            backgroundColor: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            color: "var(--card-foreground)",
          }}
        />
        <ReferenceLine
          y={overallAvg}
          stroke="var(--muted-foreground)"
          strokeDasharray="3 3"
          strokeOpacity={0.4}
          label={{
            value: `avg ${(overallAvg / 1000).toFixed(0)}k`,
            position: "insideTopRight",
            fill: "var(--muted-foreground)",
            fontSize: 11,
          }}
        />
        <Bar
          dataKey="volume"
          fill="var(--primary)"
          radius={[4, 4, 0, 0]}
        />
        <Line
          type="monotone"
          dataKey="avg"
          name="4-week avg"
          stroke="oklch(72% 0.19 50)"
          strokeWidth={2}
          dot={false}
          strokeDasharray="4 2"
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
