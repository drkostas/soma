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

  // Compute tight domains so small fluctuations are visible
  const enduranceValues = chartData.map((d) => d.endurance).filter((v): v is number => v !== null);
  const hillValues = chartData.map((d) => d.hill).filter((v): v is number => v !== null);

  const endMin = enduranceValues.length > 0 ? Math.min(...enduranceValues) : 0;
  const endMax = enduranceValues.length > 0 ? Math.max(...enduranceValues) : 100;
  const endPad = Math.max((endMax - endMin) * 0.15, 50);

  const hillMin = hillValues.length > 0 ? Math.min(...hillValues) : 0;
  const hillMax = hillValues.length > 0 ? Math.max(...hillValues) : 100;
  const hillPad = Math.max((hillMax - hillMin) * 0.15, 3);

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
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
          tick={{ fontSize: 10, fill: "hsl(210, 80%, 60%)" }}
          orientation="left"
          domain={[Math.floor(endMin - endPad), Math.ceil(endMax + endPad)]}
          label={{ value: "Endurance", angle: -90, position: "insideLeft", style: { fontSize: 10, fill: "hsl(210, 80%, 60%)" } }}
        />
        <YAxis
          yAxisId="hill"
          tick={{ fontSize: 10, fill: "hsl(25, 80%, 55%)" }}
          orientation="right"
          domain={[Math.floor(hillMin - hillPad), Math.ceil(hillMax + hillPad)]}
          label={{ value: "Hill", angle: 90, position: "insideRight", style: { fontSize: 10, fill: "hsl(25, 80%, 55%)" } }}
        />
        <Tooltip
          contentStyle={{
            background: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "8px",
            fontSize: "12px",
          }}
          labelFormatter={(d: any) =>
            new Date(String(d)).toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            })
          }
          formatter={(value: any, name: any) => {
            const label = name === "endurance" ? "Endurance Score" : "Hill Score";
            return [Number(value).toLocaleString(), label];
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
