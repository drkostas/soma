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
    .map((p) => {
      const rawPace = p.speed && p.speed > 0 ? 1000 / p.speed / 60 : null;
      // Filter GPS speed artifacts — valid running pace 2:45–14:00 min/km
      const pace = rawPace != null && rawPace >= 2.75 && rawPace <= 14
        ? Math.round(rawPace * 100) / 100
        : null;
      return {
        dist_km: Math.round((p.dist_m! / 1000) * 100) / 100,
        elev: p.elev != null ? Math.round(p.elev) : null,
        pace,
        hr: p.hr != null ? Math.round(p.hr) : null,
        cadence: p.cadence != null && p.cadence > 10 ? Math.round(p.cadence / 2) : null, // double cadence → SPM, filter stops
      };
    });
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

const CHART_HEIGHT = 100;
// type: "number" prevents Recharts from treating dist_km as category (which shows every point as a tick)
const xAxisProps = { dataKey: "dist_km", type: "number" as const, tick: { fontSize: 9, fill: "#6b7280" }, tickLine: false, axisLine: false };
const yAxisProps = { tick: { fontSize: 9, fill: "#6b7280" }, tickLine: false, axisLine: false, width: 34 };
const tooltipStyle = { backgroundColor: "#1c1c1c", border: "1px solid #333", borderRadius: 4, fontSize: 11 };

interface RunSparklinesProps {
  points: SparkPoint[];
}

export function RunSparklines({ points }: RunSparklinesProps) {
  const data = downsample(points);

  const paceSamples = data.filter((d) => d.pace != null).map((d) => d.pace!);
  const paceMin = paceSamples.length ? Math.min(...paceSamples) : 4;
  const paceMax = paceSamples.length ? Math.max(...paceSamples) : 7;

  // Cadence: use 10th percentile as lower bound to clip slow warmup values
  const cadenceSorted = data
    .filter((d) => d.cadence != null)
    .map((d) => d.cadence!)
    .sort((a, b) => a - b);
  const cadenceP10 = cadenceSorted.length
    ? cadenceSorted[Math.floor(cadenceSorted.length * 0.1)]
    : 140;
  const cadenceMax = cadenceSorted.length ? cadenceSorted[cadenceSorted.length - 1] : 200;
  const cadenceDomain: [number, number] = [Math.max(0, cadenceP10 - 5), cadenceMax + 5];

  return (
    <div className="space-y-1 px-1">
      {/* Elevation */}
      <div>
        <div className="text-[9px] text-muted-foreground uppercase tracking-wider mb-0.5 pl-1">Elevation (m)</div>
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <XAxis {...xAxisProps} hide />
            <YAxis {...yAxisProps} domain={["auto", "auto"]} />
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
              // reversed: fast pace (small number) at TOP, slow at bottom — standard running chart convention
              reversed
              domain={[Math.max(0, paceMin - 0.5), paceMax + 0.5]}
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
            <XAxis
              {...xAxisProps}
              tickFormatter={(v) => `${v}`}
              tick={{ fontSize: 9, fill: "#6b7280" }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis {...yAxisProps} domain={cadenceDomain} />
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
