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

export function KiteSpeedChart({ data }: { data: KiteSession[] }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[250px] text-muted-foreground text-sm">
        No data
      </div>
    );
  }

  const chartData = data
    .filter((d) => d.maxSpeedKts > 0)
    .map((d) => ({
      ...d,
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
        <Scatter dataKey="maxSpeedKts" fill="#22d3ee" fillOpacity={0.8} />
        <Line
          dataKey="maxSpeedKts"
          stroke="#22d3ee"
          strokeWidth={1}
          strokeDasharray="3 3"
          dot={false}
          strokeOpacity={0.4}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
