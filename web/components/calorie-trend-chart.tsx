"use client";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { isLongRange, buildChartTicks, formatChartTick } from "@/lib/chart-utils";

interface CaloriePoint {
  date: string;
  active: number;
  bmr: number;
}

export function CalorieTrendChart({ data }: { data: CaloriePoint[] }) {
  if (data.length === 0) return null;

  const recent = data.slice(-21);

  const avgBmr = recent.length > 0
    ? Math.round(recent.reduce((s, d) => s + d.bmr, 0) / recent.length)
    : null;

  const longRange = isLongRange(recent);
  const tickDates = buildChartTicks(recent);

  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={recent} margin={{ top: 5, right: 20, bottom: 5, left: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} vertical={false} />
        <XAxis
          dataKey="date"
          className="text-[10px]"
          tickLine={false}
          tickFormatter={(d: string) => formatChartTick(d, longRange)}
          {...(tickDates ? { ticks: tickDates } : { interval: Math.max(Math.floor(recent.length / 5), 1) })}
        />
        <YAxis
          className="text-[10px]"
          tickLine={false}
          width={45}
          tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)}
        />
        {avgBmr !== null && (
          <ReferenceLine
            y={avgBmr}
            stroke="var(--muted-foreground)"
            strokeDasharray="4 2"
            strokeOpacity={0.6}
            label={{ value: `BMR ~${avgBmr}`, position: "insideTopRight", fontSize: 9, fill: "var(--muted-foreground)" }}
          />
        )}
        <Tooltip
          contentStyle={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            fontSize: "12px",
            color: "var(--card-foreground)",
          }}
          labelFormatter={(d: any) =>
            new Date(String(d)).toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            })
          }
          formatter={(value: any, name: any) => {
            const label = name === "active" ? "Active" : "BMR";
            return [`${Number(value).toLocaleString()} kcal`, label];
          }}
        />
        <Area
          type="monotone"
          dataKey="bmr"
          stackId="1"
          stroke="var(--muted-foreground)"
          fill="var(--muted)"
          fillOpacity={0.3}
          strokeWidth={0}
        />
        <Area
          type="monotone"
          dataKey="active"
          stackId="1"
          stroke="oklch(68% 0.19 45)"
          fill="oklch(68% 0.19 45)"
          fillOpacity={0.4}
          strokeWidth={1.5}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
