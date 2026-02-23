"use client";

import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { Heart } from "lucide-react";

interface HrDataPoint {
  date: string;
  avg_hr: number;
  max_hr: number;
  title: string;
  duration_min: number;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function WorkoutHrTrendChart({ data }: { data: HrDataPoint[] }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[250px] text-muted-foreground gap-2">
        <Heart className="h-6 w-6 opacity-30" />
        <span className="text-sm">No HR data available</span>
      </div>
    );
  }

  const avgHr = Math.round(data.reduce((s, d) => s + d.avg_hr, 0) / data.length);
  const maxAvgHr = Math.max(...data.map(d => d.avg_hr));
  const minAvgHr = Math.min(...data.map(d => d.avg_hr));

  // Compute chart domain
  const yMin = Math.floor(minAvgHr / 10) * 10 - 5;
  const yMax = Math.ceil(maxAvgHr / 10) * 10 + 5;

  return (
    <div>
      <div className="flex items-center gap-4 mb-3 text-xs text-muted-foreground">
        <span>Avg: <strong className="text-foreground">{avgHr} bpm</strong></span>
        <span>Range: {Math.round(minAvgHr)}–{Math.round(maxAvgHr)} bpm</span>
        <span>{data.length} workouts with HR</span>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <ScatterChart margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} />
          <XAxis
            dataKey="date"
            tickFormatter={formatDate}
            className="text-[10px]"
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            domain={[yMin, yMax]}
            className="text-[10px]"
            tickLine={false}
            axisLine={false}
            width={40}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.[0]) return null;
              const d = payload[0].payload as HrDataPoint;
              return (
                <div className="bg-popover border border-border rounded-lg p-2 text-xs shadow-md">
                  <div className="font-medium">{formatDate(d.date)}</div>
                  <div className="text-muted-foreground">{d.title}</div>
                  <div className="mt-1 space-y-0.5">
                    <div className="flex items-center gap-1 text-red-400">
                      <Heart className="h-3 w-3" /> Avg: {Math.round(d.avg_hr)} bpm
                    </div>
                    <div>Max: {Math.round(d.max_hr)} bpm</div>
                    <div>{d.duration_min}m</div>
                  </div>
                </div>
              );
            }}
          />
          <ReferenceLine
            y={avgHr}
            stroke="var(--muted-foreground)"
            strokeDasharray="6 4"
            strokeOpacity={0.4}
            label={{ value: "avg", position: "right", className: "text-[9px] fill-muted-foreground" }}
          />
          <Scatter
            data={data}
            dataKey="avg_hr"
            fill="#ef4444"
            fillOpacity={0.7}
            r={3}
          />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
