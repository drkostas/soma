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

interface VO2Entry {
  date: string;
  vo2max: number;
}

export function VO2MaxChart({ data }: { data: VO2Entry[] }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[200px] text-muted-foreground text-sm">
        No VO2max data
      </div>
    );
  }

  const chartData = data.map((d) => ({
    date: d.date,
    vo2max: Number(d.vo2max),
  }));

  const avgVo2 = chartData.length > 0
    ? Number((chartData.reduce((s, d) => s + d.vo2max, 0) / chartData.length).toFixed(1))
    : null;

  const longRange = isLongRange(chartData);
  const tickDates = buildChartTicks(chartData);

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis
          dataKey="date"
          className="text-[10px]"
          tickLine={false}
          tickFormatter={(d) => formatChartTick(d, longRange)}
          {...(tickDates ? { ticks: tickDates } : { interval: Math.max(0, Math.floor(chartData.length / 6)) })}
        />
        <YAxis
          className="text-xs"
          domain={["dataMin - 1", "dataMax + 1"]}
        />
        {avgVo2 !== null && (
          <ReferenceLine
            y={avgVo2}
            stroke="oklch(62% 0.17 142)"
            strokeDasharray="4 2"
            strokeOpacity={0.5}
            label={{ value: `avg ${avgVo2}`, position: "insideTopRight", fontSize: 9, fill: "oklch(62% 0.17 142)" }}
          />
        )}
        <Tooltip
          formatter={(value: any) => [`${value} ml/kg/min`, "VO2max"]}
          labelFormatter={(label) =>
            new Date(label).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
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
          dataKey="vo2max"
          stroke="oklch(62% 0.17 142)"
          strokeWidth={2}
          dot={{ r: 3 }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
