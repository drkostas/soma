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
  const spanDays = filtered.length > 1
    ? (new Date(filtered[filtered.length - 1].date).getTime() - new Date(filtered[0].date).getTime()) / 86400000
    : 0;
  const longRange = spanDays > 60;

  const chartData = filtered.map((d) => ({
      date: d.date,
      avg: Number(d.avg_spo2),
      low: d.low_spo2 ? Number(d.low_spo2) : null,
      sleep: d.sleep_spo2 ? Number(d.sleep_spo2) : null,
    }));

  const allVals = chartData.flatMap((d) =>
    [d.avg, d.low, d.sleep].filter((v): v is number => v !== null)
  );
  const minVal = Math.max(Math.floor(Math.min(...allVals) - 2), 80);

  const tickDates = longRange ? (() => {
    const seen = new Set<string>();
    return chartData
      .filter((d) => {
        const key = new Date(d.date).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((d) => d.date);
  })() : undefined;

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
          tickFormatter={(d: string) => {
            const date = new Date(d);
            return longRange
              ? date.toLocaleDateString("en-US", { month: "short", year: "2-digit" })
              : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          }}
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
          stroke="#4ade80"
          strokeDasharray="3 3"
          strokeOpacity={0.4}
        />
        <Area
          type="monotone"
          dataKey="avg"
          stroke="#60a5fa"
          fill="#60a5fa"
          fillOpacity={0.08}
          strokeWidth={2}
          dot={false}
          name="avg"
        />
        <Area
          type="monotone"
          dataKey="sleep"
          stroke="#a78bfa"
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
          stroke="#f87171"
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
