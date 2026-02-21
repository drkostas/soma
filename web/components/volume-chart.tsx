"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

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

  const spanDays = chartData.length > 1
    ? (new Date(chartData[chartData.length - 1].week).getTime() - new Date(chartData[0].week).getTime()) / 86400000
    : 0;
  const longRange = spanDays > 60;

  const tickDates = longRange ? (() => {
    const seen = new Set<string>();
    const unique = chartData
      .filter((d) => {
        const key = new Date(d.week).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((d) => d.week);
    if (unique.length > 8) {
      const step = Math.ceil(unique.length / 8);
      return unique.filter((_, i) => i % step === 0 || i === unique.length - 1);
    }
    return unique;
  })() : undefined;

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis
          dataKey="week"
          className="text-[10px]"
          tickLine={false}
          tickFormatter={(d) => {
            const date = new Date(d);
            return longRange
              ? date.toLocaleDateString("en-US", { month: "short", year: "2-digit" })
              : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          }}
          {...(tickDates ? { ticks: tickDates } : { interval: Math.max(0, Math.floor(chartData.length / 6)) })}
        />
        <YAxis
          className="text-xs"
          tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
        />
        <Tooltip
          cursor={{ fill: "var(--muted)", opacity: 0.3 }}
          formatter={(value: any) => [
            `${Number(value).toLocaleString()} kg`,
            "Volume",
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
        <Bar
          dataKey="volume"
          fill="var(--primary)"
          radius={[4, 4, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
