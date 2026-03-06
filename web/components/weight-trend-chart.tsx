"use client";

import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { isLongRange, buildChartTicks, formatChartTick } from "@/lib/chart-utils";

interface WeightPoint {
  date: string;
  weight_kg: number;
  body_fat: number | null;
}

export function WeightTrendChart({ data }: { data: WeightPoint[] }) {
  if (data.length === 0) return null;

  const recent = data.slice(-60);

  const weights = recent.map((d) => d.weight_kg).filter((w) => w > 0);
  const minW = Math.floor(Math.min(...weights) - 1);
  const maxW = Math.ceil(Math.max(...weights) + 1);

  const fats = recent.map((d) => d.body_fat).filter((f): f is number => f !== null && f > 0);
  const minF = fats.length > 0 ? Math.floor(Math.min(...fats) - 1) : 15;
  const maxF = fats.length > 0 ? Math.ceil(Math.max(...fats) + 1) : 25;

  const avgWeight = Math.round(weights.reduce((s, w) => s + w, 0) / weights.length * 10) / 10;

  const longRange = isLongRange(recent);
  const tickDates = buildChartTicks(recent);

  return (
    <ResponsiveContainer width="100%" height={200}>
      <ComposedChart data={recent} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 9, fill: "var(--muted-foreground)" }}
          tickFormatter={(d: string) => formatChartTick(d, longRange)}
          {...(tickDates ? { ticks: tickDates } : { interval: Math.max(Math.floor(recent.length / 6), 1) })}
        />
        <YAxis
          yAxisId="weight"
          domain={[minW, maxW]}
          className="text-[10px]"
          tickLine={false}
          tickFormatter={(v: number) => `${v}kg`}
        />
        <YAxis
          yAxisId="bf"
          orientation="right"
          domain={[minF, maxF]}
          className="text-[10px]"
          tickLine={false}
          tickFormatter={(v: number) => `${v}%`}
        />
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
            if (name === "weight_kg") return [`${Number(value).toFixed(1)} kg`, "Weight"];
            if (name === "body_fat") return [`${Number(value).toFixed(1)}%`, "Body Fat"];
            return [value, name];
          }}
        />
        {fats.length > 0 && (
          <Area
            yAxisId="bf"
            type="monotone"
            dataKey="body_fat"
            stroke="oklch(65% 0.18 270)"
            fill="oklch(65% 0.18 270)"
            fillOpacity={0.15}
            strokeWidth={1}
            connectNulls
            dot={false}
          />
        )}
        <ReferenceLine yAxisId="weight" y={avgWeight} stroke="oklch(80% 0.18 87)" strokeDasharray="4 2" strokeOpacity={0.5} label={{ value: `avg ${avgWeight}kg`, position: "insideTopRight", fontSize: 9, fill: "oklch(80% 0.18 87)" }} />
        <Line
          yAxisId="weight"
          type="monotone"
          dataKey="weight_kg"
          stroke="oklch(80% 0.18 87)"
          strokeWidth={2}
          dot={false}
          connectNulls
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
