"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from "recharts";
import { isLongRange, buildChartTicks, formatChartTick } from "@/lib/chart-utils";

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

  const longRange = isLongRange(chartData);
  const tickDates = buildChartTicks(chartData);

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={chartData}>
        <XAxis
          dataKey="date"
          className="text-[10px]"
          tickLine={false}
          tickFormatter={(d) => formatChartTick(d, longRange)}
          tick={{ fontSize: 10 }}
          {...(tickDates ? { ticks: tickDates } : { interval: Math.max(Math.floor(chartData.length / 6), 1) })}
        />
        <YAxis
          className="text-xs"
          tickFormatter={(v) => `${v}h`}
          tick={{ fontSize: 10 }}
        />
        <Tooltip
          cursor={{ fill: "var(--muted)", opacity: 0.3 }}
          formatter={(value: any, name: any) => [`${value}h`, name]}
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
        <Legend />
        <ReferenceLine
          y={7}
          stroke="oklch(65% 0.18 220)"
          strokeDasharray="4 2"
          strokeOpacity={0.5}
          label={{ value: "7h min", position: "insideBottomRight", fontSize: 9, fill: "oklch(65% 0.18 220)" }}
        />
        <ReferenceLine
          y={9}
          stroke="oklch(62% 0.17 142)"
          strokeDasharray="4 2"
          strokeOpacity={0.4}
          label={{ value: "9h target", position: "insideTopRight", fontSize: 9, fill: "oklch(62% 0.17 142)" }}
        />
        <Bar dataKey="Deep" stackId="sleep" fill="oklch(55% 0.22 270)" radius={[0, 0, 0, 0]} />
        <Bar dataKey="Light" stackId="sleep" fill="oklch(65% 0.18 270)" radius={[0, 0, 0, 0]} />
        <Bar dataKey="REM" stackId="sleep" fill="oklch(68% 0.16 285)" radius={[0, 0, 0, 0]} />
        <Bar dataKey="Awake" stackId="sleep" fill="oklch(68% 0.19 25)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
