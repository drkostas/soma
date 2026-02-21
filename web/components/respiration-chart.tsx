"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface RespirationEntry {
  date: string;
  awake_resp: number | null;
  sleep_resp: number | null;
  low_resp: number | null;
  high_resp: number | null;
}

export function RespirationChart({ data }: { data: RespirationEntry[] }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[180px] text-muted-foreground text-sm">
        No respiration data
      </div>
    );
  }

  const filtered = data.filter((d) => d.sleep_resp && Number(d.sleep_resp) > 0);
  const spanDays = filtered.length > 1
    ? (new Date(filtered[filtered.length - 1].date).getTime() - new Date(filtered[0].date).getTime()) / 86400000
    : 0;
  const longRange = spanDays > 60;

  const chartData = filtered.map((d) => ({
      date: d.date,
      sleep: Number(d.sleep_resp),
      awake: d.awake_resp ? Number(d.awake_resp) : null,
      low: d.low_resp ? Number(d.low_resp) : null,
      high: d.high_resp ? Number(d.high_resp) : null,
    }));

  const allVals = chartData.flatMap((d) =>
    [d.sleep, d.awake, d.low, d.high].filter((v): v is number => v !== null && v > 0)
  );
  const minVal = Math.max(Math.floor(Math.min(...allVals) - 2), 0);
  const maxVal = Math.ceil(Math.max(...allVals) + 2);

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
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart
        data={chartData}
        margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
      >
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
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
          {...(tickDates ? { ticks: tickDates } : { interval: Math.max(0, Math.floor(chartData.length / 6)) })}
        />
        <YAxis
          className="text-[10px]"
          tickLine={false}
          domain={[minVal, maxVal]}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            fontSize: "12px",
            color: "var(--card-foreground)",
          }}
          formatter={(value: any, name: any) => {
            const labels: Record<string, string> = {
              sleep: "Sleep",
              awake: "Awake",
              low: "Lowest",
              high: "Highest",
            };
            return [`${value} br/min`, labels[name] || name];
          }}
        />
        <Area
          type="monotone"
          dataKey="sleep"
          stroke="#38bdf8"
          fill="#38bdf8"
          fillOpacity={0.1}
          strokeWidth={2}
          dot={false}
          name="sleep"
        />
        <Area
          type="monotone"
          dataKey="awake"
          stroke="#94a3b8"
          fill="transparent"
          fillOpacity={0}
          strokeWidth={1}
          dot={false}
          name="awake"
          strokeDasharray="4 2"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
