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
  const spanDays = filtered.length > 1
    ? (new Date(filtered[filtered.length - 1].date).getTime() - new Date(filtered[0].date).getTime()) / 86400000
    : 0;
  const longRange = spanDays > 60;

  const chartData = filtered.map((d) => ({
      date: d.date,
      acute: Math.round(Number(d.acute)),
      chronic: Math.round(Number(d.chronic)),
      acwr: Number(Number(d.acwr).toFixed(2)),
    }));

  // For long-range data, pick one tick per unique month to avoid duplicate labels
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
      <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
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
        <YAxis className="text-[10px]" tickLine={false} />
        <Tooltip
          contentStyle={{
            backgroundColor: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            fontSize: "12px",
          }}
          formatter={(value: any, name: any) => {
            if (name === "acwr") return [Number(value).toFixed(2), "ACWR"];
            return [value, name === "acute" ? "Acute Load" : "Chronic Load"];
          }}
        />
        <Area
          type="monotone"
          dataKey="chronic"
          stroke="#60a5fa"
          fill="#60a5fa"
          fillOpacity={0.15}
          strokeWidth={2}
          dot={false}
          name="chronic"
        />
        <Area
          type="monotone"
          dataKey="acute"
          stroke="#f97316"
          fill="#f97316"
          fillOpacity={0.1}
          strokeWidth={2}
          dot={false}
          name="acute"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
