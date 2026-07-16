"use client";

import { useState } from "react";
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { isLongRange, buildChartTicks, formatChartTick } from "@/lib/chart-utils";

interface FitnessEntry {
  date: string;
  vo2max: number | null;
  efficiency_factor: number | null;
  decoupling_pct: number | null;
  vdot_adjusted: number | null;
}

const LINE_DEFS = [
  { key: "vo2max", label: "VO2max", color: "oklch(65% 0.15 250)", axis: "left" as const, width: 2 },
  { key: "vdot_adj", label: "VDOT (weight-adj)", color: "oklch(60% 0.2 300)", axis: "left" as const, width: 1.5, dash: "4 2" },
  { key: "decoupling", label: "Decoupling %", color: "oklch(72% 0.19 50)", axis: "right" as const, width: 1.5 },
] as const;

export function FitnessTrajectoryChart({ data }: { data: FitnessEntry[] }) {
  const [visible, setVisible] = useState<Set<string>>(() => new Set(LINE_DEFS.map(l => l.key)));
  const [dropdownOpen, setDropdownOpen] = useState(false);

  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[200px] text-muted-foreground text-sm">
        No fitness data
      </div>
    );
  }

  const chartData = data.map((d) => ({
    date: d.date,
    vo2max: d.vo2max ? Number(d.vo2max) : null,
    vdot_adj: d.vdot_adjusted ? Number(Number(d.vdot_adjusted).toFixed(1)) : null,
    decoupling: d.decoupling_pct ? Number(Number(d.decoupling_pct).toFixed(1)) : null,
  }));

  const longRange = isLongRange(chartData);
  const tickDates = buildChartTicks(chartData);
  const hasDecoupling = chartData.some((d) => d.decoupling !== null);
  const showDecouplingAxis = hasDecoupling && visible.has("decoupling");

  function toggle(key: string) {
    setVisible(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Filter available lines (decoupling only if data exists)
  const availableLines = LINE_DEFS.filter(l => l.key !== "decoupling" || hasDecoupling);

  return (
    <div>
      <div className="flex justify-end mb-1.5 relative">
        <button
          onClick={() => setDropdownOpen(o => !o)}
          className="text-[11px] px-2 py-0.5 rounded border border-border bg-card text-muted-foreground hover:text-foreground transition-colors"
        >
          Lines ({visible.size}/{availableLines.length})
        </button>
        {dropdownOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setDropdownOpen(false)} />
            <div className="absolute right-0 top-full mt-1 z-50 bg-card border border-border rounded-md shadow-lg py-1 min-w-[170px]">
              {availableLines.map(l => (
                <label
                  key={l.key}
                  className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted/50 cursor-pointer text-[11px]"
                >
                  <input
                    type="checkbox"
                    checked={visible.has(l.key)}
                    onChange={() => toggle(l.key)}
                    className="rounded border-border"
                  />
                  <span
                    className="w-3 h-0.5 rounded-full shrink-0"
                    style={{ backgroundColor: l.color }}
                  />
                  <span className="text-foreground">{l.label}</span>
                </label>
              ))}
            </div>
          </>
        )}
      </div>
      <ResponsiveContainer width="100%" height={250}>
        <ComposedChart data={chartData} margin={{ top: 5, right: showDecouplingAxis ? 36 : 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            tickLine={false}
            tickFormatter={(d: string) => formatChartTick(d, longRange)}
            {...(tickDates ? { ticks: tickDates } : { interval: Math.max(Math.floor(chartData.length / 8), 1) })}
          />
          <YAxis
            yAxisId="left"
            className="text-[10px]"
            tickLine={false}
            domain={["dataMin - 1", "dataMax + 1"]}
            label={{ value: "VO2max", angle: -90, position: "insideLeft", fontSize: 10, fill: "var(--muted-foreground)" }}
          />
          {showDecouplingAxis && (
            <YAxis
              yAxisId="right"
              orientation="right"
              className="text-[10px]"
              tickLine={false}
              domain={[0, 15]}
              tickFormatter={(v: number) => `${v}%`}
            />
          )}
          <Tooltip
            contentStyle={{
              backgroundColor: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              fontSize: "12px",
              color: "var(--card-foreground)",
            }}
            formatter={(value: any, name: any) => {
              const labels: Record<string, string> = {
                vo2max: "VO2max",
                vdot_adj: "VDOT (weight-adj)",
                decoupling: "Decoupling %",
              };
              return [name === "decoupling" ? `${value}%` : value, labels[name] || name];
            }}
          />
          {showDecouplingAxis && (
            <ReferenceLine yAxisId="right" y={5} stroke="oklch(80% 0.18 87)" strokeDasharray="3 3" strokeOpacity={0.4}
              label={{ value: "5% threshold", position: "insideTopRight", fontSize: 9, fill: "oklch(80% 0.18 87)", fillOpacity: 0.6 }}
            />
          )}
          {visible.has("vo2max") && (
            <Line yAxisId="left" type="monotone" dataKey="vo2max" stroke="oklch(65% 0.15 250)" strokeWidth={2} dot={false} connectNulls name="vo2max" />
          )}
          {visible.has("vdot_adj") && (
            <Line yAxisId="left" type="monotone" dataKey="vdot_adj" stroke="oklch(60% 0.2 300)" strokeWidth={1.5} dot={false} connectNulls strokeDasharray="4 2" name="vdot_adj" />
          )}
          {showDecouplingAxis && (
            <Line yAxisId="right" type="monotone" dataKey="decoupling" stroke="oklch(72% 0.19 50)" strokeWidth={1.5} dot={false} connectNulls name="decoupling" />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
