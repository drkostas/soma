"use client";

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

export function HRPaceChart({ data }: { data: HRPaceEntry[] }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[300px] text-muted-foreground text-sm">
        No data
      </div>
    );
  }

  const chartData = data.map((d) => ({
    pace: Number(d.pace.toFixed(2)),
    hr: Math.round(d.hr),
    distance: Number(d.distance.toFixed(1)),
    name: d.name,
    date: d.date,
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ScatterChart margin={{ bottom: 10, left: 10, right: 10 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis
          type="number"
          dataKey="pace"
          name="Pace"
          className="text-xs"
          reversed
          domain={["dataMin - 0.3", "dataMax + 0.3"]}
          tickFormatter={formatPace}
          label={{ value: "Pace (min/km)", position: "bottom", offset: 0, className: "text-xs fill-muted-foreground" }}
        />
        <YAxis
          type="number"
          dataKey="hr"
          name="Heart Rate"
          className="text-xs"
          domain={["dataMin - 5", "dataMax + 5"]}
          label={{ value: "Avg HR (bpm)", angle: -90, position: "insideLeft", className: "text-xs fill-muted-foreground" }}
        />
        <ZAxis type="number" dataKey="distance" range={[40, 200]} />
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload?.[0]) return null;
            const d = payload[0].payload;
            return (
              <div className="bg-card border border-border rounded-lg p-2 text-xs shadow-lg">
                <div className="font-medium">{d.name}</div>
                <div className="text-muted-foreground">{new Date(d.date).toLocaleDateString()}</div>
                <div className="mt-1">Pace: {formatPace(d.pace)}/km</div>
                <div>HR: {d.hr} bpm</div>
                <div>Distance: {d.distance} km</div>
              </div>
            );
          }}
        />
        <Scatter
          data={chartData}
          fill="hsl(var(--primary))"
          fillOpacity={0.7}
        />
      </ScatterChart>
    </ResponsiveContainer>
  );
}
