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

  const ma = movingAverage(data, Math.min(7, Math.ceil(data.length / 5)));

  const chartData = data.map((d, i) => ({
    date: d.date,
    pace: Number(d.pace.toFixed(2)),
    distance: Number(d.distance.toFixed(1)),
    trend: ma[i],
  }));

  const paces = chartData.map((d) => d.pace).filter((p) => p > 0 && p < 15);
  const minP = Math.floor(Math.min(...paces) - 0.3);
  const maxP = Math.ceil(Math.max(...paces) + 0.3);

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
          tickFormatter={(d) =>
            new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" })
          }
          interval={Math.max(Math.floor(chartData.length / 8), 1)}
        />
        <YAxis
          tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
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
