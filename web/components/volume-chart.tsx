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

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis
          dataKey="week"
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
          tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
        />
        <Tooltip
          formatter={(value: number) => [
            `${value.toLocaleString()} kg`,
            "Volume",
          ]}
          labelFormatter={(label) =>
            `Week of ${new Date(label).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}`
          }
          contentStyle={{
            backgroundColor: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "8px",
            color: "hsl(var(--card-foreground))",
          }}
        />
        <Bar
          dataKey="volume"
          fill="hsl(var(--primary))"
          radius={[4, 4, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
