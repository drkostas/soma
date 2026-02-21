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
  Walking: "#34d399",
  Cycling: "#fbbf24",
  Cardio: "#f87171",
  SUP: "#38bdf8",
  Other: "#a78bfa",
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

  const tickMonths = (() => {
    if (data.length <= 12) return undefined;
    const seen = new Set<string>();
    const unique = data.filter((d) => {
      const [y, m] = String(d.month).split("-");
      const key = `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][parseInt(m) - 1]} '${y.slice(2)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map((d) => d.month);
    if (unique.length > 10) {
      const step = Math.ceil(unique.length / 10);
      return unique.filter((_, i) => i % step === 0 || i === unique.length - 1);
    }
    return unique;
  })();

  return (
    <ResponsiveContainer width="100%" height={250}>
      <BarChart data={data} margin={{ bottom: 10, left: 0 }}>
        <XAxis
          dataKey="month"
          className="text-xs"
          tickFormatter={(v) => {
            const [y, m] = v.split("-");
            const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
            return `${months[parseInt(m) - 1]} '${y.slice(2)}`;
          }}
          {...(tickMonths ? { ticks: tickMonths } : {})}
        />
        <YAxis className="text-xs" allowDecimals={false} />
        <Tooltip
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            const [y, m] = String(label ?? "").split("-");
            const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
            return (
              <div className="bg-card text-card-foreground border border-border rounded-lg p-2 text-xs shadow-lg">
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
            fill={SPORT_COLORS[sport] || "var(--primary)"}
            radius={sport === sports[sports.length - 1] ? [2, 2, 0, 0] : [0, 0, 0, 0]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
