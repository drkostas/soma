"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";

interface FitnessScorePoint {
  date: string;
  endurance: number | null;
  hill: number | null;
}

export function FitnessScoresChart({ data }: { data: FitnessScorePoint[] }) {
  if (data.length === 0) return null;

  const chartData = data.map((d) => ({
    date: d.date,
    endurance: d.endurance,
    hill: d.hill,
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
          tickFormatter={(d: string) => {
            const date = new Date(d);
            return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          }}
          interval={Math.max(Math.floor(chartData.length / 6), 1)}
        />
        <YAxis
          yAxisId="endurance"
          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
          orientation="left"
        />
        <YAxis
          yAxisId="hill"
          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
          orientation="right"
        />
        <Tooltip
          contentStyle={{
            background: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "8px",
            fontSize: "12px",
          }}
          labelFormatter={(d) =>
            new Date(String(d)).toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            })
          }
          formatter={(value: any, name: any) => {
            const label = name === "endurance" ? "Endurance Score" : "Hill Score";
            return [value, label];
          }}
        />
        <Legend
          wrapperStyle={{ fontSize: "11px" }}
          formatter={(value: string) =>
            value === "endurance" ? "Endurance" : "Hill"
          }
        />
        <Line
          yAxisId="endurance"
          type="monotone"
          dataKey="endurance"
          stroke="hsl(210, 80%, 60%)"
          strokeWidth={2}
          dot={false}
          connectNulls
        />
        <Line
          yAxisId="hill"
          type="monotone"
          dataKey="hill"
          stroke="hsl(25, 80%, 55%)"
          strokeWidth={2}
          dot={false}
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
