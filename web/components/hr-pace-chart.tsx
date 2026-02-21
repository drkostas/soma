"use client";

import { useState } from "react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ZAxis,
} from "recharts";

interface HRPaceEntry {
  pace: number;
  hr: number;
  distance: number;
  name: string;
  date: string;
}

function formatPace(mins: number) {
  const m = Math.floor(mins);
  const s = Math.round((mins - m) * 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const YEAR_COLORS: Record<string, string> = {
  "2026": "#22d3ee",
  "2025": "#4ade80",
  "2024": "#facc15",
  "2023": "#f97316",
  "2022": "#a78bfa",
  "2021": "#f472b6",
  "2020": "#94a3b8",
  "2019": "#6ee7b7",
};

export function HRPaceChart({ data }: { data: HRPaceEntry[] }) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());

  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[300px] text-muted-foreground text-sm">
        No data
      </div>
    );
  }

  // Group by year for color coding
  const byYear = new Map<string, any[]>();
  for (const d of data) {
    const year = d.date.slice(0, 4);
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year)!.push({
      pace: Number(d.pace.toFixed(2)),
      hr: Math.round(d.hr),
      distance: Number(d.distance.toFixed(1)),
      name: d.name,
      date: d.date,
    });
  }

  const years = Array.from(byYear.keys()).sort();

  const toggle = (year: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-2 justify-center">
        {years.map((year) => {
          const color = YEAR_COLORS[year] || "#888";
          const active = !hidden.has(year);
          return (
            <button
              key={year}
              onClick={() => toggle(year)}
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium transition-all cursor-pointer"
              style={{
                color: active ? color : "var(--muted-foreground)",
                borderColor: active ? color : "transparent",
                backgroundColor: active ? `${color}15` : "transparent",
                border: `1px solid ${active ? color : "transparent"}`,
                opacity: active ? 1 : 0.4,
              }}
            >
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: active ? color : "var(--muted-foreground)" }} />
              {year}
            </button>
          );
        })}
      </div>
      <ResponsiveContainer width="100%" height={320}>
        <ScatterChart margin={{ bottom: 25, left: 10, right: 10 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis
            type="number"
            dataKey="pace"
            name="Pace"
            className="text-xs"
            reversed
            domain={["dataMin - 0.3", "dataMax + 0.3"]}
            tickFormatter={formatPace}
          />
          <YAxis
            type="number"
            dataKey="hr"
            name="Heart Rate"
            className="text-[10px]"
            tickLine={false}
            domain={["dataMin - 5", "dataMax + 5"]}
          />
          <ZAxis type="number" dataKey="distance" range={[30, 160]} />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.[0]) return null;
              const d = payload[0].payload;
              return (
                <div className="bg-card text-card-foreground border border-border rounded-lg p-2 text-xs shadow-lg">
                  <div className="font-medium">{d.name}</div>
                  <div className="text-muted-foreground">{new Date(d.date).toLocaleDateString()}</div>
                  <div className="mt-1">Pace: {formatPace(d.pace)}/km</div>
                  <div>HR: {d.hr} bpm</div>
                  <div>Distance: {d.distance} km</div>
                </div>
              );
            }}
          />
          {years.map((year) => {
            if (hidden.has(year)) return null;
            return (
              <Scatter
                key={year}
                name={year}
                data={byYear.get(year)}
                fill={YEAR_COLORS[year] || "#888"}
                fillOpacity={year === years[years.length - 1] ? 0.8 : 0.4}
              />
            );
          })}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
