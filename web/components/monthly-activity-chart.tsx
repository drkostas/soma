"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  LabelList,
} from "recharts";

interface MonthlyActivityEntry {
  month: string;
  [sport: string]: number | string;
}

const SPORT_COLORS: Record<string, string> = {
  Kiteboarding: "oklch(75% 0.14 195)",
  Snowboarding: "oklch(80% 0.11 250)",
  Hiking: "oklch(72% 0.19 150)",
  "E-Bike": "oklch(85% 0.17 90)",
  Swimming: "oklch(70% 0.15 250)",
  Walking: "oklch(72% 0.17 165)",
  Cycling: "oklch(83% 0.17 87)",
  Cardio: "oklch(68% 0.19 25)",
  SUP: "oklch(72% 0.15 230)",
  Other: "oklch(68% 0.16 285)",
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

  const enriched = data.map(d => ({
    ...d,
    _total: sports.reduce((sum, sport) => sum + (Number(d[sport]) || 0), 0),
  }));

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
      <BarChart data={enriched} margin={{ bottom: 10, left: 0, top: 16 }}>
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
          cursor={{ fill: "var(--muted)", opacity: 0.3 }}
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
        {sports.map((sport, idx) => (
          <Bar
            key={sport}
            dataKey={sport}
            stackId="a"
            fill={SPORT_COLORS[sport] || "var(--primary)"}
            radius={idx === sports.length - 1 ? [2, 2, 0, 0] : [0, 0, 0, 0]}
          >
            {idx === sports.length - 1 && (
              <LabelList
                dataKey="_total"
                position="top"
                style={{ fontSize: 9, fill: "var(--muted-foreground)" }}
                formatter={(v: unknown) => (typeof v === "number" && v > 0) ? String(v) : ""}
              />
            )}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
