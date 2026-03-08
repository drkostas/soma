"use client";

import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
} from "recharts";
import { isLongRange, buildChartTicks, formatChartTick } from "@/lib/chart-utils";

interface PMCEntry {
  date: string;
  ctl: number;
  atl: number;
  tsb: number;
}

interface PMCChartProps {
  data: PMCEntry[];
  raceDate?: string;
}

export function PMCChart({ data, raceDate }: PMCChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[200px] text-muted-foreground text-sm">
        No PMC data
      </div>
    );
  }

  const chartData = data.map((d) => ({
    date: d.date,
    ctl: Math.round(Number(d.ctl)),
    atl: Math.round(Number(d.atl)),
    tsb: Math.round(Number(d.tsb)),
  }));

  const longRange = isLongRange(chartData);
  const tickDates = buildChartTicks(chartData);

  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
          tickLine={false}
          tickFormatter={(d: string) => formatChartTick(d, longRange)}
          {...(tickDates ? { ticks: tickDates } : { interval: Math.max(Math.floor(chartData.length / 8), 1) })}
        />
        <YAxis
          className="text-[10px]"
          tickLine={false}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            fontSize: "12px",
            color: "var(--card-foreground)",
          }}
          labelFormatter={(d) =>
            new Date(String(d)).toLocaleDateString("en-US", {
              weekday: "short", month: "short", day: "numeric",
            })
          }
          formatter={(value: any, name: any) => {
            const labels: Record<string, string> = {
              ctl: "Fitness (CTL)",
              atl: "Fatigue (ATL)",
              tsb: "Form (TSB)",
            };
            return [value, labels[name] || name];
          }}
        />
        <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeDasharray="3 3" strokeOpacity={0.4} />
        <ReferenceArea
          y1={15} y2={20}
          fill="oklch(62% 0.17 142)"
          fillOpacity={0.08}
        />
        <ReferenceLine
          y={15}
          stroke="oklch(62% 0.17 142)"
          strokeDasharray="5 5"
          strokeOpacity={0.3}
          label={{ value: "Race TSB target", position: "insideTopRight", fontSize: 9, fill: "oklch(62% 0.17 142)", fillOpacity: 0.6 }}
        />
        {raceDate && (
          <ReferenceLine
            x={raceDate}
            stroke="oklch(60% 0.2 300)"
            strokeDasharray="3 3"
            strokeOpacity={0.6}
            label={{ value: "Race", position: "top", fontSize: 9, fill: "oklch(60% 0.2 300)" }}
          />
        )}
        <Line
          type="monotone"
          dataKey="ctl"
          stroke="oklch(65% 0.15 250)"
          strokeWidth={2}
          dot={false}
          name="ctl"
        />
        <Line
          type="monotone"
          dataKey="atl"
          stroke="oklch(65% 0.2 25)"
          strokeWidth={2}
          dot={false}
          name="atl"
        />
        <Area
          type="monotone"
          dataKey="tsb"
          stroke="oklch(70% 0.15 145)"
          fill="oklch(70% 0.15 145)"
          fillOpacity={0.15}
          strokeWidth={1.5}
          dot={false}
          name="tsb"
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
