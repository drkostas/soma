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

interface SpO2Entry {
  date: string;
  avg_spo2: number | null;
  low_spo2: number | null;
  sleep_spo2: number | null;
}

export function SpO2Chart({ data }: { data: SpO2Entry[] }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[200px] text-muted-foreground text-sm">
        No SpO2 data
      </div>
    );
  }

  const filtered = data.filter((d) => d.avg_spo2 && Number(d.avg_spo2) > 0);

  const chartData = filtered.map((d) => ({
      date: d.date,
      avg: Number(d.avg_spo2),
      low: d.low_spo2 ? Number(d.low_spo2) : null,
      sleep: d.sleep_spo2 ? Number(d.sleep_spo2) : null,
    }));

  const allVals = chartData.flatMap((d) =>
    [d.avg, d.low, d.sleep].filter((v): v is number => v !== null)
  );
  if (!allVals.length) return <div className="flex items-center justify-center h-[200px] text-muted-foreground text-sm">No SpO2 data</div>;
  const minVal = Math.max(Math.floor(Math.min(...allVals) - 2), 80);

  const longRange = isLongRange(chartData);
  const tickDates = buildChartTicks(chartData);

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart
        data={chartData}
        margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
      >
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis
          dataKey="date"
          className="text-[10px]"
          tickLine={false}
          tickFormatter={(d: string) => formatChartTick(d, longRange)}
          {...(tickDates ? { ticks: tickDates } : { interval: Math.max(0, Math.floor(chartData.length / 6)) })}
        />
        <YAxis
          className="text-[10px]"
          tickLine={false}
          domain={[minVal, 100]}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            fontSize: "12px",
            color: "var(--card-foreground)",
          }}
          formatter={(value: any, name: any) => {
            const labels: Record<string, string> = {
              avg: "Average SpO2",
              sleep: "Sleep SpO2",
              low: "Lowest",
            };
            return [`${value}%`, labels[name] || name];
          }}
        />
        <ReferenceLine
          y={95}
          stroke="oklch(62% 0.17 142)"
          strokeDasharray="3 3"
          strokeOpacity={0.5}
          label={{ value: "95% normal", position: "insideTopRight", fontSize: 9, fill: "oklch(62% 0.17 142)" }}
        />
        <Area
          type="monotone"
          dataKey="avg"
          stroke="oklch(70% 0.15 250)"
          fill="oklch(70% 0.15 250)"
          fillOpacity={0.08}
          strokeWidth={2}
          dot={false}
          name="avg"
        />
        <Area
          type="monotone"
          dataKey="sleep"
          stroke="oklch(68% 0.16 285)"
          fill="transparent"
          fillOpacity={0}
          strokeWidth={1.5}
          dot={false}
          name="sleep"
          strokeDasharray="4 2"
        />
        <Area
          type="monotone"
          dataKey="low"
          stroke="oklch(68% 0.19 25)"
          fill="transparent"
          fillOpacity={0}
          strokeWidth={1}
          dot={false}
          name="low"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
