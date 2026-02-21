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

interface BodyBatteryPoint {
  date: string;
  charged: number;
  drained: number;
}

export function BodyBatteryChart({ data }: { data: BodyBatteryPoint[] }) {
  if (data.length === 0) return null;

  const chartData = data.slice(-21).map((d) => ({
    date: d.date,
    charged: Number(d.charged),
    drained: -Number(d.drained),
    net: Number(d.charged) - Number(d.drained),
  }));

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: -10 }} stackOffset="sign">
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
          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
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
            const label = name === "charged" ? "Charged" : "Drained";
            return [`${Math.abs(Number(value))}%`, label];
          }}
        />
        <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" opacity={0.3} />
        <Bar dataKey="charged" stackId="a" radius={[3, 3, 0, 0]}>
          {chartData.map((_, index) => (
            <Cell key={index} fill="hsl(142, 71%, 45%)" opacity={0.6} />
          ))}
        </Bar>
        <Bar dataKey="drained" stackId="a" radius={[0, 0, 3, 3]}>
          {chartData.map((_, index) => (
            <Cell key={index} fill="hsl(0, 84%, 60%)" opacity={0.5} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
