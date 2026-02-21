"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface YearlyData {
  month: number;
  [year: string]: number;
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const YEAR_COLORS = [
  "#22d3ee", // cyan (most recent)
  "#4ade80", // green
  "#facc15", // yellow
  "#f97316", // orange
  "#a78bfa", // purple
  "#f472b6", // pink
  "#94a3b8", // slate
  "#6ee7b7", // emerald
];

export function YearlyMileageChart({
  data,
  years,
}: {
  data: YearlyData[];
  years: string[];
}) {
  if (!data || data.length === 0 || years.length === 0) {
    return (
      <div className="flex items-center justify-center h-[250px] text-muted-foreground text-sm">
        No data
      </div>
    );
  }

  // Most recent year gets brightest color
  const sortedYears = [...years].sort((a, b) => b.localeCompare(a));

  return (
    <ResponsiveContainer width="100%" height={250}>
      <LineChart data={data} margin={{ left: 0, right: 10 }}>
        <XAxis
          dataKey="month"
          tickFormatter={(m) => MONTH_LABELS[m - 1] || ""}
          className="text-xs"
        />
        <YAxis className="text-xs" tickFormatter={(v) => `${v}km`} />
        <Tooltip
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            return (
              <div className="bg-card border border-border rounded-lg p-2 text-xs shadow-lg">
                <div className="font-medium mb-1">{MONTH_LABELS[(label as number) - 1]}</div>
                {payload
                  .filter((p: any) => p.value > 0)
                  .sort((a: any, b: any) => b.value - a.value)
                  .map((p: any) => (
                    <div key={p.dataKey} className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
                      <span>{p.dataKey}: {Number(p.value).toFixed(1)} km</span>
                    </div>
                  ))}
              </div>
            );
          }}
        />
        <Legend
          wrapperStyle={{ fontSize: "12px" }}
          iconType="line"
          iconSize={12}
        />
        {sortedYears.map((year, i) => (
          <Line
            key={year}
            dataKey={year}
            stroke={YEAR_COLORS[i % YEAR_COLORS.length]}
            strokeWidth={i === 0 ? 2.5 : 1.5}
            strokeOpacity={i === 0 ? 1 : 0.6}
            dot={i === 0}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
