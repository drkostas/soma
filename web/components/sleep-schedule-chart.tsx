"use client";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { isLongRange, buildChartTicks, formatChartTick } from "@/lib/chart-utils";

interface SleepSchedulePoint {
  date: string;
  bedtimeHour: number | null; // hours past midnight (e.g., 23.5 = 11:30 PM)
  wakeHour: number | null;
}

function formatHour(h: number): string {
  // Convert decimal hour to readable time
  const hour = Math.floor(h);
  const min = Math.round((h - hour) * 60);
  const period = hour >= 12 ? "PM" : "AM";
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${h12}:${min.toString().padStart(2, "0")} ${period}`;
}

export function SleepScheduleChart({ data }: { data: SleepSchedulePoint[] }) {
  if (data.length === 0) return null;

  // Normalize bedtime: if after 6 PM (18), keep as-is. If before, add 24 for display
  // This handles overnight sleep properly (e.g., 23:00 → 7:00)
  const chartData = data.map((d) => {
    let bed = d.bedtimeHour;
    if (bed !== null && bed < 18) bed += 24; // Wrap early morning bedtimes
    return {
      date: d.date,
      bedtime: bed,
      wake: d.wakeHour,
    };
  });

  // Get last 30 data points
  const recent = chartData.slice(-30);

  const longRange = isLongRange(recent);
  const tickDates = buildChartTicks(recent);

  // Compute dynamic Y-axis domain from actual data
  const bedtimes = recent.map((d) => d.bedtime).filter((v): v is number => v !== null);
  const wakes = recent.map((d) => d.wake).filter((v): v is number => v !== null);
  const allValues = [...bedtimes, ...wakes];

  let domainMin: number;
  let domainMax: number;

  if (allValues.length === 0) {
    domainMin = 5;
    domainMax = 27;
  } else {
    const dataMin = Math.min(...allValues);
    const dataMax = Math.max(...allValues);
    // Pad by 1 hour on each side
    domainMin = Math.floor(dataMin) - 1;
    domainMax = Math.ceil(dataMax) + 1;
    // Clamp to reasonable bounds: min at least 18 (6 PM) side for bedtime display is wrong —
    // since wake times can be as low as 5 AM, we keep domainMin flexible but floor at 0
    // For the reversed axis: lower number = top, higher = bottom
    // Wake times (small numbers) should be at top, bedtimes (large numbers) at bottom
    domainMin = Math.max(domainMin, 0);
    domainMax = Math.min(domainMax, 33); // 9 AM next day max
    // Ensure at least 6 hours span for readability
    if (domainMax - domainMin < 6) {
      const mid = (domainMin + domainMax) / 2;
      domainMin = Math.floor(mid - 3);
      domainMax = Math.ceil(mid + 3);
    }
  }

  // Generate ticks every 2 hours within domain
  const yTicks: number[] = [];
  const firstTick = Math.ceil(domainMin / 2) * 2;
  for (let t = firstTick; t <= domainMax; t += 2) {
    yTicks.push(t);
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={recent} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
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
          domain={[domainMin, domainMax]}
          reversed
          tickFormatter={(h: number) => {
            const actual = h >= 24 ? h - 24 : h;
            return formatHour(actual);
          }}
          ticks={yTicks}
          width={60}
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
            new Date(d instanceof Date ? d.toISOString() : String(d)).toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            })
          }
          formatter={(value: any, name: any) => {
            const h = Number(value);
            const actual = h > 24 ? h - 24 : h;
            const label = name === "bedtime" ? "Bedtime" : "Wake Time";
            return [formatHour(actual), label];
          }}
        />
        <Area
          type="monotone"
          dataKey="bedtime"
          stroke="oklch(50% 0.22 275)"
          fill="oklch(50% 0.22 275)"
          fillOpacity={0.15}
          strokeWidth={2}
          dot={false}
          connectNulls
        />
        <Area
          type="monotone"
          dataKey="wake"
          stroke="oklch(80% 0.16 75)"
          fill="oklch(80% 0.16 75)"
          fillOpacity={0.15}
          strokeWidth={2}
          dot={false}
          connectNulls
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
