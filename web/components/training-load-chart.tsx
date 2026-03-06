"use client";

import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { isLongRange, buildChartTicks, formatChartTick } from "@/lib/chart-utils";

interface TrainingLoadEntry {
  date: string;
  acute: number | null;
  chronic: number | null;
  acwr: number | null;
}

export function TrainingLoadChart({ data }: { data: TrainingLoadEntry[] }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[200px] text-muted-foreground text-sm">
        No data
      </div>
    );
  }

  const filtered = data.filter((d) => d.acute !== null && d.chronic !== null);

  const chartData = filtered.map((d) => ({
      date: d.date,
      acute: Math.round(Number(d.acute)),
      chronic: Math.round(Number(d.chronic)),
      acwr: d.acwr !== null ? Number(d.acwr.toFixed(2)) : null,
    }));

  const longRange = isLongRange(chartData);
  const tickDates = buildChartTicks(chartData);

  const hasAcwr = chartData.some((d) => d.acwr !== null);

  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={chartData} margin={{ top: 5, right: hasAcwr ? 36 : 10, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis
          dataKey="date"
          className="text-[10px]"
          tickLine={false}
          tickFormatter={(d: string) => formatChartTick(d, longRange)}
          {...(tickDates ? { ticks: tickDates } : { interval: Math.max(0, Math.floor(chartData.length / 6)) })}
        />
        <YAxis yAxisId="left" className="text-[10px]" tickLine={false} />
        {hasAcwr && (
          <YAxis
            yAxisId="right"
            orientation="right"
            className="text-[10px]"
            tickLine={false}
            domain={[0, 2.5]}
            tickFormatter={(v: number) => v.toFixed(1)}
          />
        )}
        <Tooltip
          contentStyle={{
            backgroundColor: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            fontSize: "12px",
            color: "var(--card-foreground)",
          }}
          formatter={(value: any, name: any) => {
            if (name === "acwr") return [Number(value).toFixed(2), "ACWR"];
            return [value, name === "acute" ? "Acute Load" : "Chronic Load"];
          }}
        />
        <Area
          yAxisId="left"
          type="monotone"
          dataKey="chronic"
          stroke="oklch(70% 0.15 250)"
          fill="oklch(70% 0.15 250)"
          fillOpacity={0.15}
          strokeWidth={2}
          dot={false}
          name="chronic"
        />
        <Area
          yAxisId="left"
          type="monotone"
          dataKey="acute"
          stroke="oklch(72% 0.19 50)"
          fill="oklch(72% 0.19 50)"
          fillOpacity={0.1}
          strokeWidth={2}
          dot={false}
          name="acute"
        />
        {hasAcwr && (
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="acwr"
            stroke="oklch(80% 0.18 87)"
            strokeWidth={2}
            dot={false}
            name="acwr"
            strokeDasharray="4 2"
            connectNulls={false}
          />
        )}
        {hasAcwr && (
          <ReferenceLine
            yAxisId="right"
            y={0.8}
            stroke="oklch(65% 0.18 220)"
            strokeDasharray="3 3"
            strokeOpacity={0.5}
            label={{ value: "0.8", position: "right", fontSize: 9, fill: "oklch(65% 0.18 220)" }}
          />
        )}
        {hasAcwr && (
          <ReferenceLine
            yAxisId="right"
            y={1.3}
            stroke="oklch(80% 0.18 87)"
            strokeDasharray="3 3"
            strokeOpacity={0.5}
            label={{ value: "1.3", position: "right", fontSize: 9, fill: "oklch(80% 0.18 87)" }}
          />
        )}
        {hasAcwr && (
          <ReferenceLine
            yAxisId="right"
            y={1.5}
            stroke="oklch(60% 0.22 25)"
            strokeDasharray="3 3"
            strokeOpacity={0.5}
            label={{ value: "1.5 ⚠", position: "right", fontSize: 9, fill: "oklch(60% 0.22 25)" }}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
