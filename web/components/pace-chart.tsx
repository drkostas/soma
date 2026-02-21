"use client";

import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ComposedChart,
  Scatter,
  Line,
} from "recharts";

interface PaceEntry {
  date: string;
  pace: number; // min/km
  distance: number; // km
}

function formatPace(mins: number) {
  const m = Math.floor(mins);
  const s = Math.round((mins - m) * 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function movingAverage(data: { pace: number }[], window: number) {
  return data.map((_, i) => {
    const start = Math.max(0, i - window + 1);
    const slice = data.slice(start, i + 1);
    const avg = slice.reduce((s, d) => s + d.pace, 0) / slice.length;
    return Number(avg.toFixed(2));
  });
}

export function PaceChart({ data }: { data: PaceEntry[] }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[300px] text-muted-foreground">
        No pace data yet.
      </div>
    );
  }

  // Filter out extreme outliers (walks/warmups > 9 min/km)
  const filtered = data.filter((d) => d.pace > 2.5 && d.pace < 9);
  const ma = movingAverage(filtered, Math.min(7, Math.ceil(filtered.length / 5)));

  const chartData = filtered.map((d, i) => ({
    date: d.date,
    pace: Number(d.pace.toFixed(2)),
    distance: Number(d.distance.toFixed(1)),
    trend: ma[i],
  }));

  const paces = chartData.map((d) => d.pace);
  const minP = Math.floor(Math.min(...paces) - 0.3);
  const maxP = Math.ceil(Math.max(...paces) + 0.3);

  const spanDays = chartData.length > 1
    ? (new Date(chartData[chartData.length - 1].date).getTime() - new Date(chartData[0].date).getTime()) / 86400000
    : 0;
  const longRange = spanDays > 60;

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
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
          tickFormatter={(d) => {
            const date = new Date(d);
            return longRange
              ? date.toLocaleDateString("en-US", { month: "short", year: "2-digit" })
              : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          }}
          {...(tickDates ? { ticks: tickDates } : { interval: Math.max(Math.floor(chartData.length / 6), 1) })}
        />
        <YAxis
          className="text-[10px]"
          tickLine={false}
          reversed
          domain={[minP, maxP]}
          tickFormatter={formatPace}
        />
        <Tooltip
          formatter={(value: any, name: any) => {
            if (name === "trend") return [formatPace(value) + "/km", "Trend"];
            if (name === "pace") return [formatPace(value) + "/km", "Pace"];
            return [`${value} km`, "Distance"];
          }}
          labelFormatter={(label) =>
            new Date(label).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            })
          }
          contentStyle={{
            background: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "8px",
            fontSize: "12px",
          }}
        />
        <Scatter
          dataKey="pace"
          fill="hsl(168, 70%, 45%)"
          fillOpacity={0.4}
          r={3}
          name="pace"
        />
        <Line
          type="monotone"
          dataKey="trend"
          stroke="hsl(168, 70%, 55%)"
          strokeWidth={2}
          dot={false}
          name="trend"
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
