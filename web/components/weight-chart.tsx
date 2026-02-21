"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface WeightEntry {
  date: string;
  weight_kg: number;
}

interface WeightChartProps {
  data: WeightEntry[];
}

export function WeightChart({ data }: WeightChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[350px] text-muted-foreground">
        No weight data yet. Run the sync pipeline to get started.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={350}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis
          dataKey="date"
          className="text-xs"
          tickFormatter={(d) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        />
        <YAxis
          domain={["dataMin - 1", "dataMax + 1"]}
          className="text-xs"
          tickFormatter={(v) => `${v.toFixed(1)}`}
        />
        <Tooltip
          formatter={(value: number | undefined) => {
            if (value === undefined) return ["—", "Weight"];
            return [`${value.toFixed(1)} kg`, "Weight"];
          }}
          labelFormatter={(label) => new Date(label).toLocaleDateString()}
          contentStyle={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            fontSize: "12px",
            color: "var(--card-foreground)",
          }}
        />
        <Line
          type="monotone"
          dataKey="weight_kg"
          stroke="var(--primary)"
          strokeWidth={2}
          dot={{ r: 3 }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
