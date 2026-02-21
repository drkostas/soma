"use client";

import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface CadenceStrideEntry {
  date: string;
  cadence: number;
  stride: number;
}

export function CadenceStrideChart({
  data,
}: {
  data: CadenceStrideEntry[];
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
      <ComposedChart data={data} margin={{ bottom: 10, left: -10, right: 10 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis
          dataKey="date"
          className="text-[10px]"
          tickLine={false}
          tickFormatter={(v) =>
            new Date(v).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })
          }
          interval={Math.max(0, Math.floor(data.length / 6))}
        />
        <YAxis
          yAxisId="cadence"
          className="text-xs"
          domain={["dataMin - 5", "dataMax + 5"]}
          label={{
            value: "spm",
            angle: -90,
            position: "insideLeft",
            className: "text-xs fill-muted-foreground",
          }}
        />
        <YAxis
          yAxisId="stride"
          orientation="right"
          className="text-xs"
          domain={["dataMin - 5", "dataMax + 5"]}
          label={{
            value: "cm",
            angle: 90,
            position: "insideRight",
            className: "text-xs fill-muted-foreground",
          }}
        />
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload?.[0]) return null;
            const d = payload[0].payload;
            return (
              <div className="bg-card border border-border rounded-lg p-2 text-xs shadow-lg">
                <div className="font-medium">
                  {new Date(d.date).toLocaleDateString()}
                </div>
                <div className="mt-1">Cadence: {d.cadence} spm</div>
                <div>Stride: {d.stride} cm</div>
              </div>
            );
          }}
        />
        <Bar
          yAxisId="cadence"
          dataKey="cadence"
          fill="hsl(var(--primary))"
          fillOpacity={0.3}
          radius={[2, 2, 0, 0]}
        />
        <Line
          yAxisId="stride"
          type="monotone"
          dataKey="stride"
          stroke="#f59e0b"
          strokeWidth={2}
          dot={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
