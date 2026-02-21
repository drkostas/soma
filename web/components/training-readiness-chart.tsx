"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
  ReferenceLine,
} from "recharts";

interface ReadinessDataPoint {
  date: string;
  score: number;
  level: string;
}

function scoreColor(score: number): string {
  if (score >= 70) return "hsl(142, 71%, 45%)"; // green
  if (score >= 40) return "hsl(48, 96%, 53%)";  // yellow
  return "hsl(0, 84%, 60%)";                     // red
}

export function TrainingReadinessChart({ data }: { data: ReadinessDataPoint[] }) {
  if (data.length === 0) return null;

  const chartData = data.slice(-30).map((d) => ({
    date: d.date,
    score: Number(d.score),
    level: d.level,
  }));

  const spanDays = chartData.length > 1
    ? (new Date(chartData[chartData.length - 1].date).getTime() - new Date(chartData[0].date).getTime()) / 86400000
    : 0;
  const longRange = spanDays > 60;

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
          tickFormatter={(d: string) => {
            const date = new Date(d);
            return longRange
              ? date.toLocaleDateString("en-US", { month: "short", year: "2-digit" })
              : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          }}
          interval={Math.max(Math.floor(chartData.length / 6), 1)}
        />
        <YAxis
          className="text-[10px]"
          tickLine={false}
          domain={[0, 100]}
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
          formatter={(value: any, _name: any, item: any) => [
            `${value} (${item.payload.level?.toLowerCase() || ""})`,
            "Score",
          ]}
        />
        <ReferenceLine y={70} stroke="hsl(142, 71%, 45%)" strokeDasharray="3 3" opacity={0.5} />
        <ReferenceLine y={40} stroke="hsl(48, 96%, 53%)" strokeDasharray="3 3" opacity={0.5} />
        <Bar dataKey="score" radius={[3, 3, 0, 0]}>
          {chartData.map((entry, index) => (
            <Cell key={index} fill={scoreColor(entry.score)} opacity={0.7} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
