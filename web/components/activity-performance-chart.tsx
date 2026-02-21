"use client";

import { useState, useMemo } from "react";
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

interface TimeSeriesPoint {
  elapsed_sec: number;
  hr: number | null;
  speed: number | null;
  elevation: number | null;
  cadence: number | null;
  power: number | null;
  respiration: number | null;
  stride: number | null;
}

interface ActivityPerformanceChartProps {
  timeSeries: TimeSeriesPoint[];
}

const METRICS = [
  { key: "pace", label: "Pace", color: "#60a5fa", unit: "/km" },
  { key: "hr", label: "Heart Rate", color: "#ef4444", unit: " bpm" },
  { key: "elevation", label: "Elevation", color: "#4ade80", unit: " m" },
  { key: "cadence", label: "Cadence", color: "#f97316", unit: " spm" },
  { key: "power", label: "Power", color: "#a78bfa", unit: " W" },
  { key: "respiration", label: "Breathing", color: "#38bdf8", unit: " br/min" },
  { key: "stride", label: "Stride", color: "#f472b6", unit: " cm" },
] as const;

type MetricKey = (typeof METRICS)[number]["key"];

function formatElapsed(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatPaceValue(minPerKm: number): string {
  const m = Math.floor(minPerKm);
  const s = Math.round((minPerKm - m) * 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function downsample<T>(data: T[], target: number): T[] {
  if (data.length <= target) return data;
  const step = data.length / target;
  const result: T[] = [];
  for (let i = 0; i < target; i++) {
    result.push(data[Math.floor(i * step)]);
  }
  // Always include the last point
  if (result[result.length - 1] !== data[data.length - 1]) {
    result.push(data[data.length - 1]);
  }
  return result;
}

interface ChartPoint {
  elapsed_sec: number;
  pace: number | null;
  hr: number | null;
  elevation: number | null;
  cadence: number | null;
  power: number | null;
  respiration: number | null;
  stride: number | null;
}

function PerformanceTooltip({
  active,
  payload,
  enabled,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartPoint }>;
  enabled: Set<MetricKey>;
}) {
  if (!active || !payload?.[0]) return null;
  const point = payload[0].payload;

  return (
    <div className="bg-popover border border-border rounded-lg px-3 py-2 shadow-md text-xs space-y-0.5">
      <div className="font-medium text-foreground mb-1">
        {formatElapsed(point.elapsed_sec)}
      </div>
      {METRICS.map((m) => {
        if (!enabled.has(m.key)) return null;
        const val = point[m.key];
        if (val == null) return null;
        const display =
          m.key === "pace"
            ? formatPaceValue(val) + m.unit
            : m.key === "elevation"
              ? val.toFixed(0) + m.unit
              : m.key === "hr" || m.key === "cadence" || m.key === "stride"
                ? Math.round(val) + m.unit
                : val.toFixed(1) + m.unit;
        return (
          <div key={m.key} className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: m.color }}
            />
            <span className="text-muted-foreground">{m.label}:</span>
            <span className="font-medium text-foreground">{display}</span>
          </div>
        );
      })}
    </div>
  );
}

export function ActivityPerformanceChart({
  timeSeries,
}: ActivityPerformanceChartProps) {
  const [enabled, setEnabled] = useState<Set<MetricKey>>(
    () => new Set(["pace", "hr"])
  );

  const toggle = (key: MetricKey) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // Convert speed to pace and downsample
  const chartData = useMemo(() => {
    const converted: ChartPoint[] = timeSeries.map((p) => ({
      elapsed_sec: p.elapsed_sec,
      pace:
        p.speed != null && p.speed > 0.3
          ? 1000 / p.speed / 60
          : null,
      hr: p.hr,
      elevation: p.elevation,
      cadence: p.cadence,
      power: p.power,
      respiration: p.respiration,
      stride: p.stride != null ? Math.round(p.stride * 100) : null,
    }));
    return downsample(converted, 300);
  }, [timeSeries]);

  // Detect which metrics have data
  const hasDataFor = useMemo(() => {
    const result: Record<MetricKey, boolean> = {
      pace: false,
      hr: false,
      elevation: false,
      cadence: false,
      power: false,
      respiration: false,
      stride: false,
    };
    for (const p of chartData) {
      if (p.pace != null) result.pace = true;
      if (p.hr != null) result.hr = true;
      if (p.elevation != null) result.elevation = true;
      if (p.cadence != null) result.cadence = true;
      if (p.power != null) result.power = true;
      if (p.respiration != null) result.respiration = true;
      if (p.stride != null) result.stride = true;
    }
    return result;
  }, [chartData]);

  // Calculate pace domain (inverted)
  const paceDomain = useMemo(() => {
    const paces = chartData
      .map((p) => p.pace)
      .filter((v): v is number => v != null);
    if (paces.length === 0) return [4, 8] as [number, number];
    const min = Math.floor(Math.min(...paces) * 10) / 10;
    const max = Math.ceil(Math.max(...paces) * 10) / 10;
    // Add some padding
    return [Math.max(min - 0.3, 0), max + 0.3] as [number, number];
  }, [chartData]);

  // Right Y-axis domain (HR / Power / Respiration — NOT cadence)
  const rightDomain = useMemo(() => {
    let allVals: number[] = [];
    for (const p of chartData) {
      if (enabled.has("hr") && p.hr != null) allVals.push(p.hr);
      if (enabled.has("power") && p.power != null) allVals.push(p.power);
      if (enabled.has("respiration") && p.respiration != null)
        allVals.push(p.respiration);
    }
    if (allVals.length === 0) return [0, 200] as [number, number];
    const min = Math.floor(Math.min(...allVals));
    const max = Math.ceil(Math.max(...allVals));
    const padding = (max - min) * 0.1 || 10;
    return [Math.max(min - padding, 0), max + padding] as [number, number];
  }, [chartData, enabled]);

  // Cadence domain (dedicated axis for tight spread)
  const cadenceDomain = useMemo(() => {
    const vals = chartData
      .map((p) => p.cadence)
      .filter((v): v is number => v != null);
    if (vals.length === 0) return [150, 200] as [number, number];
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const padding = Math.max((max - min) * 0.15, 3);
    return [Math.floor(min - padding), Math.ceil(max + padding)] as [number, number];
  }, [chartData]);

  // Stride domain (dedicated axis for tight spread)
  const strideDomain = useMemo(() => {
    const vals = chartData
      .map((p) => p.stride)
      .filter((v): v is number => v != null);
    if (vals.length === 0) return [80, 150] as [number, number];
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const padding = Math.max((max - min) * 0.15, 2);
    return [Math.floor(min - padding), Math.ceil(max + padding)] as [number, number];
  }, [chartData]);

  // Elevation domain
  const elevDomain = useMemo(() => {
    const vals = chartData
      .map((p) => p.elevation)
      .filter((v): v is number => v != null);
    if (vals.length === 0) return [0, 100] as [number, number];
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const padding = (max - min) * 0.1 || 5;
    return [Math.max(min - padding, 0), max + padding] as [number, number];
  }, [chartData]);

  const showPaceAxis = enabled.has("pace");
  const showRightAxis =
    enabled.has("hr") ||
    enabled.has("power") ||
    enabled.has("respiration");
  const showElevAxis = enabled.has("elevation");
  const showCadenceAxis = enabled.has("cadence");
  const showStrideAxis = enabled.has("stride");

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {METRICS.map((m) => {
          if (!hasDataFor[m.key]) return null;
          const isActive = enabled.has(m.key);
          return (
            <button
              key={m.key}
              onClick={() => toggle(m.key)}
              className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors border ${
                isActive
                  ? "border-current"
                  : "border-transparent bg-muted text-muted-foreground"
              }`}
              style={
                isActive
                  ? {
                      color: m.color,
                      borderColor: m.color,
                      backgroundColor: `${m.color}15`,
                    }
                  : {}
              }
            >
              {m.label}
            </button>
          );
        })}
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart
          data={chartData}
          margin={{ top: 5, right: showRightAxis ? 5 : 15, bottom: 5, left: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" opacity={0.15} />

          <XAxis
            dataKey="elapsed_sec"
            tickFormatter={formatElapsed}
            tick={{ fontSize: 10 }}
            stroke="var(--muted-foreground)"
            tickLine={false}
            axisLine={false}
          />

          {/* Left Y-axis: Pace (inverted) */}
          {showPaceAxis && (
            <YAxis
              yAxisId="pace"
              orientation="left"
              domain={[paceDomain[1], paceDomain[0]]}
              reversed
              tickFormatter={(v: number) => formatPaceValue(v)}
              tick={{ fontSize: 10 }}
              stroke="#60a5fa"
              tickLine={false}
              axisLine={false}
              width={40}
            />
          )}

          {/* Right Y-axis: HR / Cadence / Power / Respiration */}
          {showRightAxis && (
            <YAxis
              yAxisId="right"
              orientation="right"
              domain={rightDomain}
              tick={{ fontSize: 10 }}
              stroke="var(--muted-foreground)"
              tickLine={false}
              axisLine={false}
              width={35}
            />
          )}

          {/* Hidden elevation Y-axis for Area scaling */}
          {showElevAxis && (
            <YAxis
              yAxisId="elevation"
              domain={elevDomain}
              hide
            />
          )}

          {/* Cadence Y-axis (dedicated for tight spread) */}
          {showCadenceAxis && (
            <YAxis
              yAxisId="cadence"
              orientation={showRightAxis ? "left" : "right"}
              domain={cadenceDomain}
              tick={{ fontSize: 10 }}
              stroke="#f97316"
              tickLine={false}
              axisLine={false}
              width={35}
              tickFormatter={(v: number) => `${v}`}
            />
          )}

          {/* Stride Y-axis (dedicated for tight spread) */}
          {showStrideAxis && (
            <YAxis
              yAxisId="stride"
              orientation={showRightAxis ? "left" : "right"}
              domain={strideDomain}
              tick={{ fontSize: 10 }}
              stroke="#f472b6"
              tickLine={false}
              axisLine={false}
              width={35}
              tickFormatter={(v: number) => `${v}`}
            />
          )}

          {/* Fallback hidden axes for metrics that aren't shown but might be toggled */}
          {!showPaceAxis && <YAxis yAxisId="pace" hide />}
          {!showRightAxis && <YAxis yAxisId="right" hide />}
          {!showElevAxis && <YAxis yAxisId="elevation" hide />}
          {!showCadenceAxis && <YAxis yAxisId="cadence" hide />}
          {!showStrideAxis && <YAxis yAxisId="stride" hide />}

          <Tooltip
            content={<PerformanceTooltip enabled={enabled} />}
            cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }}
          />

          {/* Elevation area (behind lines) */}
          {enabled.has("elevation") && (
            <Area
              yAxisId="elevation"
              dataKey="elevation"
              fill="#4ade80"
              fillOpacity={0.12}
              stroke="#4ade80"
              strokeWidth={1}
              strokeOpacity={0.4}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          )}

          {/* Pace line */}
          {enabled.has("pace") && (
            <Line
              yAxisId="pace"
              dataKey="pace"
              stroke="#60a5fa"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          )}

          {/* HR line */}
          {enabled.has("hr") && (
            <Line
              yAxisId="right"
              dataKey="hr"
              stroke="#ef4444"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          )}

          {/* Cadence line (dedicated axis) */}
          {enabled.has("cadence") && (
            <Line
              yAxisId="cadence"
              dataKey="cadence"
              stroke="#f97316"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          )}

          {/* Power line */}
          {enabled.has("power") && (
            <Line
              yAxisId="right"
              dataKey="power"
              stroke="#a78bfa"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          )}

          {/* Respiration line */}
          {enabled.has("respiration") && (
            <Line
              yAxisId="right"
              dataKey="respiration"
              stroke="#38bdf8"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          )}

          {/* Stride line (dedicated axis for visibility) */}
          {enabled.has("stride") && (
            <Line
              yAxisId="stride"
              dataKey="stride"
              stroke="#f472b6"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
