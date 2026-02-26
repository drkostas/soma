"use client";

import {
  ResponsiveContainer,
  AreaChart,
  LineChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import type { GpsPoint } from "./run-map";

export interface SparkPoint {
  dist_km: number;
  elev: number | null;
  pace: number | null;
  hr: number | null;
  cadence: number | null;
}

export function buildSparkPoints(points: GpsPoint[]): SparkPoint[] {
  return points
    .filter((p) => p.dist_m != null)
    .map((p) => ({
      dist_km: Math.round((p.dist_m! / 1000) * 100) / 100,
      elev: p.elev != null ? Math.round(p.elev) : null,
      pace: p.speed && p.speed > 0.5 ? Math.round((1000 / p.speed / 60) * 100) / 100 : null,
      hr: p.hr != null ? Math.round(p.hr) : null,
      cadence: p.cadence != null ? Math.round(p.cadence / 2) : null, // double cadence → SPM
    }));
}

function downsample<T>(arr: T[], maxPoints = 200): T[] {
  if (arr.length <= maxPoints) return arr;
  const step = Math.ceil(arr.length / maxPoints);
  return arr.filter((_, i) => i % step === 0);
}

function hrColor(hr: number | null): string {
  if (!hr) return "#3b82f6";
  if (hr < 120) return "#64748b";
  if (hr < 140) return "#3b82f6";
  if (hr < 155) return "#22c55e";
  if (hr < 170) return "#f97316";
  return "#ef4444";
}

const CHART_HEIGHT = 72;
const xAxisProps = { dataKey: "dist_km", tick: { fontSize: 9, fill: "#6b7280" }, tickLine: false, axisLine: false };
const yAxisProps = { tick: { fontSize: 9, fill: "#6b7280" }, tickLine: false, axisLine: false, width: 28 };
const tooltipStyle = { backgroundColor: "#1c1c1c", border: "1px solid #333", borderRadius: 4, fontSize: 11 };

interface RunSparklinesProps {
  points: SparkPoint[];
}

export function RunSparklines({ points }: RunSparklinesProps) {
  const data = downsample(points);

  const paceMin = Math.min(...data.filter((d) => d.pace != null).map((d) => d.pace!));
  const paceMax = Math.max(...data.filter((d) => d.pace != null).map((d) => d.pace!));

  return (
    <div className="space-y-1 px-1">
      {/* Elevation */}
      <div>
        <div className="text-[9px] text-muted-foreground uppercase tracking-wider mb-0.5 pl-1">Elevation (m)</div>
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <XAxis {...xAxisProps} hide />
            <YAxis {...yAxisProps} />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v: any) => [`${v}m`, "Elev"]}
              labelFormatter={(l) => `${l} km`}
            />
            <Area
              type="monotone"
              dataKey="elev"
              stroke="#4ade80"
              fill="#4ade80"
              fillOpacity={0.2}
              dot={false}
              strokeWidth={1.5}
              connectNulls
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Pace */}
      <div>
        <div className="text-[9px] text-muted-foreground uppercase tracking-wider mb-0.5 pl-1">Pace (min/km)</div>
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <LineChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <XAxis {...xAxisProps} hide />
            <YAxis
              {...yAxisProps}
              domain={[
                paceMin > 0 ? Math.max(0, paceMin - 0.5) : "auto",
                paceMax > 0 ? paceMax + 0.5 : "auto",
              ]}
              reversed
              tickFormatter={(v) => {
                const m = Math.floor(v);
                const s = Math.round((v - m) * 60);
                return `${m}:${s.toString().padStart(2, "0")}`;
              }}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v: any) => {
                const m = Math.floor(v);
                const s = Math.round((v - m) * 60);
                return [`${m}:${s.toString().padStart(2, "0")}/km`, "Pace"];
              }}
              labelFormatter={(l) => `${l} km`}
            />
            <Line
              type="monotone"
              dataKey="pace"
              stroke="#00e5ff"
              dot={false}
              strokeWidth={1.5}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Heart Rate */}
      <div>
        <div className="text-[9px] text-muted-foreground uppercase tracking-wider mb-0.5 pl-1">Heart Rate (bpm)</div>
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <LineChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <XAxis {...xAxisProps} hide />
            <YAxis {...yAxisProps} domain={["auto", "auto"]} />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v: any) => [`${v} bpm`, "HR"]}
              labelFormatter={(l) => `${l} km`}
            />
            <Line
              type="monotone"
              dataKey="hr"
              stroke={hrColor(
                data.length > 0
                  ? (data.reduce((s, d) => s + (d.hr ?? 0), 0) / data.filter((d) => d.hr).length)
                  : null
              )}
              dot={false}
              strokeWidth={1.5}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Cadence */}
      <div>
        <div className="text-[9px] text-muted-foreground uppercase tracking-wider mb-0.5 pl-1">Cadence (spm)</div>
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <LineChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <XAxis {...xAxisProps} tick={{ fontSize: 9, fill: "#6b7280" }} tickLine={false} axisLine={false} />
            <YAxis {...yAxisProps} domain={["auto", "auto"]} />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v: any) => [`${v} spm`, "Cadence"]}
              labelFormatter={(l) => `${l} km`}
            />
            <Line
              type="monotone"
              dataKey="cadence"
              stroke="#f97316"
              dot={false}
              strokeWidth={1.5}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
