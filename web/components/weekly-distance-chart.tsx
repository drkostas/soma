"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

interface WeeklyEntry {
  week: string;
  km: number;
  runs: number;
}

export function WeeklyDistanceChart({ data }: { data: WeeklyEntry[] }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[250px] text-muted-foreground text-sm">
        No data
      </div>
    );
  }

  const avgKm =
    data.reduce((s, d) => s + d.km, 0) / data.length;

  const spanDays = data.length > 1
    ? (new Date(data[data.length - 1].week).getTime() - new Date(data[0].week).getTime()) / 86400000
    : 0;
  const longRange = spanDays > 60;

  return (
    <ResponsiveContainer width="100%" height={250}>
      <BarChart data={data} margin={{ bottom: 10, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis
          dataKey="week"
          className="text-[10px]"
          tickLine={false}
          tickFormatter={(v) => {
            const d = new Date(v);
            return longRange
              ? d.toLocaleDateString("en-US", { month: "short", year: "2-digit" })
              : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          }}
          interval={Math.max(0, Math.floor(data.length / 6))}
        />
        <YAxis className="text-xs" />
        <ReferenceLine
          y={avgKm}
          stroke="hsl(var(--muted-foreground))"
          strokeDasharray="3 3"
          strokeOpacity={0.5}
          label={{
            value: `avg ${avgKm.toFixed(1)}`,
            position: "right",
            className: "text-xs fill-muted-foreground",
          }}
        />
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload?.[0]) return null;
            const d = payload[0].payload;
            const weekDate = new Date(d.week);
            return (
              <div className="bg-card border border-border rounded-lg p-2 text-xs shadow-lg">
                <div className="font-medium">
                  Week of{" "}
                  {weekDate.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </div>
                <div className="mt-1">{d.km.toFixed(1)} km</div>
                <div className="text-muted-foreground">{d.runs} runs</div>
              </div>
            );
          }}
        />
        <Bar
          dataKey="km"
          fill="hsl(var(--primary))"
          radius={[2, 2, 0, 0]}
          fillOpacity={0.8}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
