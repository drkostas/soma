"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";

// --- Types ---

interface DataPoint {
  date: string;
  value: number | null;
  value2?: number | null;
}

interface MetricResponse {
  current: DataPoint[];
  previous: DataPoint[];
  summary: {
    current_avg: number | null;
    current_min: number | null;
    current_max: number | null;
    previous_avg: number | null;
  };
}

type ChartType = "bar" | "line" | "area" | "stacked-area" | "stacked-bar";
type Range = "7d" | "30d" | "90d" | "1y";

interface MetricConfig {
  title: string;
  chart: ChartType;
  color: string;
  color2?: string;
  unit: string;
  labels?: [string, string];
  format?: (v: number) => string;
}

const METRIC_CONFIG: Record<string, MetricConfig> = {
  steps: {
    title: "Daily Steps",
    chart: "bar",
    color: "#60a5fa",
    unit: "",
    format: (v) => v.toLocaleString(),
  },
  calories: {
    title: "Daily Calories",
    chart: "stacked-area",
    color: "#f97316",
    color2: "#94a3b8",
    unit: "kcal",
    labels: ["Active", "BMR"],
  },
  rhr: {
    title: "Resting Heart Rate",
    chart: "line",
    color: "#ef4444",
    unit: "bpm",
  },
  vo2max: {
    title: "VO2max Trend",
    chart: "line",
    color: "#eab308",
    unit: "ml/kg/min",
  },
  sleep: {
    title: "Sleep Duration",
    chart: "area",
    color: "#818cf8",
    unit: "hours",
    format: (v) => v.toFixed(1),
  },
  stress: {
    title: "Stress Level",
    chart: "area",
    color: "#eab308",
    color2: "#ef4444",
    unit: "",
    labels: ["Average", "Peak"],
  },
  body_battery: {
    title: "Body Battery",
    chart: "stacked-bar",
    color: "#4ade80",
    color2: "#f87171",
    unit: "",
    labels: ["Charged", "Drained"],
  },
  activities: {
    title: "Daily Activities",
    chart: "bar",
    color: "#a78bfa",
    unit: "",
  },
  recovery: {
    title: "Recovery Status",
    chart: "area",
    color: "#4ade80",
    color2: "#818cf8",
    unit: "",
    labels: ["Body Battery Peak", "HRV Weekly Avg"],
  },
};

const RANGES: Range[] = ["7d", "30d", "90d", "1y"];

// --- Component ---

interface StatDetailDialogProps {
  metric: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function StatDetailDialog({
  metric,
  open,
  onOpenChange,
}: StatDetailDialogProps) {
  const [range, setRange] = useState<Range>("30d");
  const [data, setData] = useState<MetricResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    if (!metric) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/stats/${metric}?range=${range}`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (err) {
      console.error("Failed to fetch stat data:", err);
    } finally {
      setLoading(false);
    }
  }, [metric, range]);

  useEffect(() => {
    if (open && metric) {
      fetchData();
    }
  }, [open, metric, range, fetchData]);

  // Reset range when opening a different metric
  useEffect(() => {
    if (!open) {
      setData(null);
      setRange("30d");
    }
  }, [open]);

  const config = metric ? METRIC_CONFIG[metric] : null;
  if (!config) return null;

  const fmt = config.format || ((v: number) => String(Math.round(v)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{config.title}</DialogTitle>
          <DialogDescription>
            {config.unit ? `Measured in ${config.unit}` : "Trend over time"}
          </DialogDescription>
        </DialogHeader>

        {/* Range toggles */}
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <Button
              key={r}
              variant={range === r ? "default" : "outline"}
              size="xs"
              onClick={() => setRange(r)}
            >
              {r}
            </Button>
          ))}
        </div>

        {/* Chart */}
        <div className="h-64 w-full">
          {loading ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              Loading...
            </div>
          ) : data && data.current.length > 0 ? (
            <MetricChart
              config={config}
              data={data}
              range={range}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm gap-1">
              <span>No data available for this period</span>
              <span className="text-xs">Data may still be syncing from Garmin — try a wider range or check back later</span>
            </div>
          )}
        </div>

        {/* Summary stats */}
        {data && data.summary.current_avg !== null && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t">
            <SummaryStat
              label="Average"
              value={fmt(data.summary.current_avg)}
              unit={config.unit}
            />
            <SummaryStat
              label="Min"
              value={data.summary.current_min !== null ? fmt(data.summary.current_min) : "--"}
              unit={config.unit}
            />
            <SummaryStat
              label="Max"
              value={data.summary.current_max !== null ? fmt(data.summary.current_max) : "--"}
              unit={config.unit}
            />
            <SummaryStat
              label="Prev. Avg"
              value={data.summary.previous_avg !== null ? fmt(data.summary.previous_avg) : "--"}
              unit={config.unit}
              diff={
                data.summary.current_avg !== null && data.summary.previous_avg !== null
                  ? data.summary.current_avg - data.summary.previous_avg
                  : null
              }
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// --- Sub-components ---

function SummaryStat({
  label,
  value,
  unit,
  diff,
}: {
  label: string;
  value: string;
  unit: string;
  diff?: number | null;
}) {
  return (
    <div>
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
        {label}
      </div>
      <div className="text-lg font-bold">
        {value}
        {unit && (
          <span className="text-xs font-normal text-muted-foreground ml-1">
            {unit}
          </span>
        )}
      </div>
      {diff !== undefined && diff !== null && (
        <div
          className={`text-[10px] ${
            diff >= 0 ? "text-green-400" : "text-red-400"
          }`}
        >
          {diff >= 0 ? "+" : ""}
          {Math.abs(diff) >= 100 ? Math.round(diff).toLocaleString() : diff.toFixed(1)}
          {" vs prev"}
        </div>
      )}
    </div>
  );
}

// --- Chart renderer ---

function MetricChart({
  config,
  data,
  range,
}: {
  config: MetricConfig;
  data: MetricResponse;
  range: Range;
}) {
  // Merge current + previous into a single array for charting
  // Previous period gets aligned by index (day offset)
  const chartData = data.current.map((d, i) => {
    const prev = data.previous[i];
    return {
      date: d.date,
      value: d.value,
      value2: d.value2 ?? null,
      prev_value: prev?.value ?? null,
    };
  });

  const longRange = chartData.length > 60;
  const tickInterval = Math.max(Math.floor(chartData.length / 6), 1);

  const tooltipStyle = {
    background: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    fontSize: "12px",
    color: "var(--card-foreground)",
  };

  const formatDate = (d: string) => {
    const date = new Date(d);
    return longRange
      ? date.toLocaleDateString("en-US", { month: "short", year: "2-digit" })
      : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const formatDateTooltip = (d: any) =>
    new Date(String(d)).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  const commonXAxisProps = {
    dataKey: "date" as const,
    className: "text-[10px]",
    tickLine: false,
    tickFormatter: formatDate,
    interval: tickInterval,
  };

  const commonYAxisProps = {
    className: "text-[10px]",
    tickLine: false,
    width: 40,
  };

  const gridProps = {
    strokeDasharray: "3 3",
    stroke: "var(--border)",
    opacity: 0.3,
    vertical: false,
  };

  // Determine label for value in tooltip
  const label1 = config.labels?.[0] || config.title;
  const label2 = config.labels?.[1] || "Secondary";
  const unit = config.unit ? ` ${config.unit}` : "";

  switch (config.chart) {
    case "bar":
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis {...commonXAxisProps} />
            <YAxis
              {...commonYAxisProps}
              tickFormatter={(v: number) =>
                v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
              }
            />
            <Tooltip
              cursor={{ fill: "var(--muted)", opacity: 0.3 }}
              contentStyle={tooltipStyle}
              labelFormatter={formatDateTooltip}
              formatter={(value: any, name: any) => {
                const lbl = name === "prev_value" ? `Prev ${label1}` : label1;
                return [`${(config.format || ((v: number) => v.toLocaleString()))(value)}${unit}`, lbl];
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: "10px" }}
              formatter={(val: string) =>
                val === "value" ? label1 : val === "prev_value" ? `Prev. Period` : val
              }
            />
            <Bar dataKey="value" radius={[2, 2, 0, 0]} fill={config.color} />
            <Bar
              dataKey="prev_value"
              radius={[2, 2, 0, 0]}
              fill={config.color}
              fillOpacity={0.2}
              stroke={config.color}
              strokeDasharray="3 3"
              strokeOpacity={0.5}
            />
          </BarChart>
        </ResponsiveContainer>
      );

    case "stacked-bar":
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis {...commonXAxisProps} />
            <YAxis {...commonYAxisProps} />
            <Tooltip
              cursor={{ fill: "var(--muted)", opacity: 0.3 }}
              contentStyle={tooltipStyle}
              labelFormatter={formatDateTooltip}
              formatter={(value: any, name: any) => {
                const lbl =
                  name === "value" ? label1 : name === "value2" ? label2 : `Prev ${label1}`;
                return [`${Math.round(value)}${unit}`, lbl];
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: "10px" }}
              formatter={(val: string) =>
                val === "value" ? label1 : val === "value2" ? label2 : `Prev. Period`
              }
            />
            <Bar dataKey="value" stackId="a" fill={config.color} radius={[0, 0, 0, 0]} />
            <Bar
              dataKey="value2"
              stackId="a"
              fill={config.color2 || config.color}
              radius={[2, 2, 0, 0]}
            />
            <Bar
              dataKey="prev_value"
              fill={config.color}
              fillOpacity={0.15}
              stroke={config.color}
              strokeDasharray="3 3"
              strokeOpacity={0.4}
              radius={[2, 2, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      );

    case "line":
      return (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis {...commonXAxisProps} />
            <YAxis {...commonYAxisProps} domain={["auto", "auto"]} />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={formatDateTooltip}
              formatter={(value: any, name: any) => {
                const lbl = name === "prev_value" ? `Prev ${label1}` : label1;
                return [`${(config.format || ((v: number) => String(Math.round(v))))(value)}${unit}`, lbl];
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: "10px" }}
              formatter={(val: string) =>
                val === "value" ? label1 : `Prev. Period`
              }
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke={config.color}
              strokeWidth={2}
              dot={chartData.length <= 30}
              activeDot={{ r: 4 }}
            />
            <Line
              type="monotone"
              dataKey="prev_value"
              stroke={config.color}
              strokeWidth={1.5}
              strokeDasharray="4 4"
              strokeOpacity={0.35}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      );

    case "area":
      return (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis {...commonXAxisProps} />
            <YAxis {...commonYAxisProps} />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={formatDateTooltip}
              formatter={(value: any, name: any) => {
                const lbl =
                  name === "value"
                    ? label1
                    : name === "value2"
                    ? label2
                    : `Prev ${label1}`;
                return [`${(config.format || ((v: number) => String(Math.round(v))))(value)}${unit}`, lbl];
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: "10px" }}
              formatter={(val: string) =>
                val === "value" ? label1 : val === "value2" ? label2 : `Prev. Period`
              }
            />
            {/* Previous period faded */}
            <Area
              type="monotone"
              dataKey="prev_value"
              stroke={config.color}
              fill={config.color}
              fillOpacity={0.05}
              strokeWidth={1.5}
              strokeDasharray="4 4"
              strokeOpacity={0.35}
              dot={false}
            />
            {/* Main value */}
            <Area
              type="monotone"
              dataKey="value"
              stroke={config.color}
              fill={config.color}
              fillOpacity={0.3}
              strokeWidth={2}
            />
            {/* Secondary value (e.g. peak stress) */}
            {config.color2 && (
              <Area
                type="monotone"
                dataKey="value2"
                stroke={config.color2}
                fill={config.color2}
                fillOpacity={0.1}
                strokeWidth={1}
                strokeDasharray="2 2"
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      );

    case "stacked-area":
      return (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis {...commonXAxisProps} />
            <YAxis
              {...commonYAxisProps}
              tickFormatter={(v: number) =>
                v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)
              }
            />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={formatDateTooltip}
              formatter={(value: any, name: any) => {
                const lbl =
                  name === "value"
                    ? label1
                    : name === "value2"
                    ? label2
                    : `Prev ${label1}`;
                return [`${Math.round(value).toLocaleString()}${unit}`, lbl];
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: "10px" }}
              formatter={(val: string) =>
                val === "value" ? label1 : val === "value2" ? label2 : `Prev. Period`
              }
            />
            {/* Previous period faded */}
            <Area
              type="monotone"
              dataKey="prev_value"
              stroke={config.color}
              fill={config.color}
              fillOpacity={0.05}
              strokeWidth={1.5}
              strokeDasharray="4 4"
              strokeOpacity={0.35}
              dot={false}
            />
            <Area
              type="monotone"
              dataKey="value2"
              stackId="current"
              stroke={config.color2 || "var(--muted-foreground)"}
              fill={config.color2 || "var(--muted)"}
              fillOpacity={0.3}
              strokeWidth={0}
            />
            <Area
              type="monotone"
              dataKey="value"
              stackId="current"
              stroke={config.color}
              fill={config.color}
              fillOpacity={0.4}
              strokeWidth={1.5}
            />
          </AreaChart>
        </ResponsiveContainer>
      );
  }
}
