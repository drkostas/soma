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
import { isLongRange, buildChartTicks, formatChartTick } from "@/lib/chart-utils";

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

function computeRadius(distanceKm: number) {
  const MIN_R = 2;
  const MAX_R = 7;
  const MIN_D = 3;
  const MAX_D = 15;
  const clamped = Math.max(MIN_D, Math.min(MAX_D, distanceKm));
  return MIN_R + ((clamped - MIN_D) / (MAX_D - MIN_D)) * (MAX_R - MIN_R);
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

  const longRange = isLongRange(chartData);
  const tickDates = buildChartTicks(chartData);

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 9, fill: "var(--muted-foreground)" }}
          tickFormatter={(d) => formatChartTick(d, longRange)}
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
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            fontSize: "12px",
            color: "var(--card-foreground)",
          }}
        />
        <Scatter
          dataKey="pace"
          fill="oklch(65% 0.14 175)"
          name="pace"
          shape={(props: any) => (
            <circle
              cx={props.cx}
              cy={props.cy}
              r={computeRadius(props.payload.distance)}
              fill={props.fill}
              opacity={0.5}
            />
          )}
        />
        <Line
          type="monotone"
          dataKey="trend"
          stroke="oklch(72% 0.14 175)"
          strokeWidth={2}
          dot={false}
          name="trend"
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
