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

  const spanDays = recent.length > 1
    ? (new Date(recent[recent.length - 1].date).getTime() - new Date(recent[0].date).getTime()) / 86400000
    : 0;
  const longRange = spanDays > 60;

  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={recent} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
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
          interval={Math.max(Math.floor(recent.length / 5), 1)}
        />
        <YAxis
          className="text-[10px]"
          tickLine={false}
          domain={[5, 27]}
          reversed
          tickFormatter={(h: number) => {
            const actual = h >= 24 ? h - 24 : h;
            return formatHour(actual);
          }}
          ticks={[7, 9, 22, 24, 26]}
          width={60}
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
            const h = Number(value);
            const actual = h > 24 ? h - 24 : h;
            const label = name === "bedtime" ? "Bedtime" : "Wake Time";
            return [formatHour(actual), label];
          }}
        />
        <Area
          type="monotone"
          dataKey="bedtime"
          stroke="hsl(250, 60%, 55%)"
          fill="hsl(250, 60%, 55%)"
          fillOpacity={0.15}
          strokeWidth={2}
          dot={false}
          connectNulls
        />
        <Area
          type="monotone"
          dataKey="wake"
          stroke="hsl(40, 80%, 55%)"
          fill="hsl(40, 80%, 55%)"
          fillOpacity={0.15}
          strokeWidth={2}
          dot={false}
          connectNulls
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
