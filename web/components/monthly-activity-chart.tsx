"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface MonthlyActivityEntry {
  month: string;
  [sport: string]: number | string;
}

const SPORT_COLORS: Record<string, string> = {
  Kiteboarding: "#22d3ee",
  Snowboarding: "#93c5fd",
  Hiking: "#4ade80",
  "E-Bike": "#facc15",
  Swimming: "#60a5fa",
};

export function MonthlyActivityChart({
  data,
  sports,
}: {
  data: MonthlyActivityEntry[];
  sports: string[];
}) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[250px] text-muted-foreground text-sm">
        No data
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={250}>
      <BarChart data={data} margin={{ bottom: 10, left: -10 }}>
        <XAxis
          dataKey="month"
          className="text-xs"
          tickFormatter={(v) => {
            const [y, m] = v.split("-");
            const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
            return `${months[parseInt(m) - 1]} '${y.slice(2)}`;
          }}
        />
        <YAxis className="text-xs" allowDecimals={false} />
        <Tooltip
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            const [y, m] = String(label ?? "").split("-");
            const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
            return (
              <div className="bg-card border border-border rounded-lg p-2 text-xs shadow-lg">
                <div className="font-medium mb-1">{months[parseInt(m) - 1]} {y}</div>
                {payload.filter((p: any) => p.value > 0).map((p: any) => (
                  <div key={p.dataKey} className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
                    <span>{p.dataKey}: {p.value}</span>
                  </div>
                ))}
              </div>
            );
          }}
        />
        <Legend
          wrapperStyle={{ fontSize: "12px" }}
          iconType="circle"
          iconSize={8}
        />
        {sports.map((sport) => (
          <Bar
            key={sport}
            dataKey={sport}
            stackId="a"
            fill={SPORT_COLORS[sport] || "hsl(var(--primary))"}
            radius={sport === sports[sports.length - 1] ? [2, 2, 0, 0] : [0, 0, 0, 0]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
