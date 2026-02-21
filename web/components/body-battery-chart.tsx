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

  const chartData = data.slice(-14).map((d) => ({
    date: d.date,
    charged: Number(d.charged),
    drained: -Number(d.drained),
    net: Number(d.charged) - Number(d.drained),
  }));

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
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }} stackOffset="sign">
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
        <XAxis
          dataKey="date"
          className="text-[10px]"
          tickLine={false}
          tickFormatter={(d: string) => {
            const date = new Date(d);
            return longRange
              ? date.toLocaleDateString("en-US", { month: "short", year: "2-digit" })
              : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          }}
          {...(tickDates ? { ticks: tickDates } : { interval: Math.max(Math.floor(chartData.length / 5), 1) })}
        />
        <YAxis
          className="text-[10px]"
          tickLine={false}
          width={35}
          tickFormatter={(v: number) => `${v}%`}
        />
        <Tooltip
          contentStyle={{
            background: "var(--card)",
            border: "1px solid var(--border)",
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
        <ReferenceLine y={0} stroke="var(--muted-foreground)" opacity={0.3} />
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
