"use client";

import {
  ComposedChart,
  Scatter,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface KiteSession {
  date: string;
  maxSpeedKts: number;
  distanceKm: number;
  spot: string;
  jump?: number;
}

function computeMA(data: { maxSpeedKts: number }[], window: number) {
  return data.map((_, i) => {
    const start = Math.max(0, i - Math.floor(window / 2));
    const end = Math.min(data.length, i + Math.ceil(window / 2));
    const slice = data.slice(start, end).filter((d) => d.maxSpeedKts > 0);
    if (slice.length === 0) return null;
    return slice.reduce((s, d) => s + d.maxSpeedKts, 0) / slice.length;
  });
}

export function KiteSpeedChart({ data }: { data: KiteSession[] }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[250px] text-muted-foreground text-sm">
        No data
      </div>
    );
  }

  const filtered = data.filter((d) => d.maxSpeedKts > 0);
  const window = Math.min(5, Math.ceil(filtered.length / 4));
  const ma = computeMA(filtered, window);

  const chartData = filtered.map((d, i) => ({
    ...d,
    trend: ma[i] ? Number(ma[i]!.toFixed(1)) : null,
    dateLabel: new Date(d.date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
  }));

  return (
    <ResponsiveContainer width="100%" height={250}>
      <ComposedChart data={chartData} margin={{ bottom: 10, left: -10, right: 10 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis dataKey="dateLabel" className="text-xs" />
        <YAxis
          className="text-xs"
          domain={[10, "dataMax + 3"]}
          label={{
            value: "knots",
            angle: -90,
            position: "insideLeft",
            className: "text-xs fill-muted-foreground",
          }}
        />
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload?.[0]) return null;
            const d = payload[0].payload;
            return (
              <div className="bg-card border border-border rounded-lg p-2 text-xs shadow-lg">
                <div className="font-medium">{d.spot}</div>
                <div className="text-muted-foreground">
                  {new Date(d.date).toLocaleDateString()}
                </div>
                <div className="mt-1">Max Speed: {d.maxSpeedKts} kts</div>
                <div>Distance: {d.distanceKm} km</div>
                {d.jump > 0 && <div>Jump: {d.jump}m</div>}
              </div>
            );
          }}
        />
        <Scatter dataKey="maxSpeedKts" fill="#22d3ee" fillOpacity={0.5} r={4} />
        <Line
          dataKey="trend"
          stroke="#22d3ee"
          strokeWidth={2}
          dot={false}
          connectNulls
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
