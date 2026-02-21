"use client";

import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Line,
  ComposedChart,
  Area,
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

export function PaceChart({ data }: { data: PaceEntry[] }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[300px] text-muted-foreground">
        No pace data yet.
      </div>
    );
  }

  const chartData = data.map((d) => ({
    date: d.date,
    pace: Number(d.pace.toFixed(2)),
    distance: Number(d.distance.toFixed(1)),
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis
          dataKey="date"
          className="text-xs"
          tickFormatter={(d) =>
            new Date(d).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })
          }
        />
        <YAxis
          className="text-xs"
          reversed
          domain={["dataMin - 0.5", "dataMax + 0.5"]}
          tickFormatter={formatPace}
        />
        <Tooltip
          formatter={(value: any, name: any) => {
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
            backgroundColor: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "8px",
            color: "hsl(var(--card-foreground))",
          }}
        />
        <Area
          type="monotone"
          dataKey="pace"
          fill="hsl(var(--primary) / 0.1)"
          stroke="none"
        />
        <Scatter
          dataKey="pace"
          fill="hsl(var(--primary))"
          r={4}
          name="pace"
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
