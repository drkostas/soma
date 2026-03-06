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
  ReferenceLine,
} from "recharts";
import { isLongRange, buildChartTicks, formatChartTick } from "@/lib/chart-utils";

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

  const longRange = isLongRange(data);
  const tickDates = buildChartTicks(data);

  return (
    <ResponsiveContainer width="100%" height={250}>
      <ComposedChart data={data} margin={{ bottom: 10, left: 0, right: 10 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis
          dataKey="date"
          className="text-[10px]"
          tickLine={false}
          tickFormatter={(v) => formatChartTick(v, longRange)}
          {...(tickDates ? { ticks: tickDates } : { interval: Math.max(0, Math.floor(data.length / 6)) })}
        />
        <YAxis
          yAxisId="cadence"
          className="text-[10px]"
          tickLine={false}
          domain={["dataMin - 5", "dataMax + 5"]}
        />
        <YAxis
          yAxisId="stride"
          orientation="right"
          className="text-[10px]"
          tickLine={false}
          domain={["dataMin - 5", "dataMax + 5"]}
          width={35}
        />
        <Tooltip
          cursor={{ fill: "var(--muted)", opacity: 0.3 }}
          content={({ active, payload }) => {
            if (!active || !payload?.[0]) return null;
            const d = payload[0].payload;
            return (
              <div className="bg-card text-card-foreground border border-border rounded-lg p-2 text-xs shadow-lg">
                <div className="font-medium">
                  {new Date(d.date).toLocaleDateString()}
                </div>
                <div className="mt-1">Cadence: {d.cadence} spm</div>
                <div>Stride: {d.stride} cm</div>
              </div>
            );
          }}
        />
        <ReferenceLine
          yAxisId="cadence"
          y={180}
          stroke="oklch(62% 0.17 142)"
          strokeDasharray="4 4"
          strokeWidth={1.5}
          label={{ value: "180 spm", position: "left", fontSize: 10, fill: "oklch(62% 0.17 142)" }}
        />
        <Bar
          yAxisId="cadence"
          dataKey="cadence"
          fill="var(--primary)"
          fillOpacity={0.3}
          radius={[2, 2, 0, 0]}
        />
        <Line
          yAxisId="stride"
          type="monotone"
          dataKey="stride"
          stroke="oklch(80% 0.18 80)"
          strokeWidth={2}
          dot={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
