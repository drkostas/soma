"use client";

import { useCallback } from "react";
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

interface TrajectoryEntry {
  date: string;
  optimal: number;
  actual: number | null;
}

interface TrajectoryChartProps {
  data: TrajectoryEntry[];
  raceDate: string;
  today: string;
  goalVdot: number;
  /** Shadow trajectory curve (e.g. delta simulation preview) */
  shadowData?: { date: string; shadow: number }[] | null;
  /** Emitted on chart hover — date string or null when leaving */
  onHoverDate?: (date: string | null) => void;
}

// ── Gap-colored dot for the actual line ──────────────────────

function GapDot(props: any) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null || payload?.actual == null) return null;

  const gap = Math.abs(payload.optimal - payload.actual);
  let fill: string;
  if (gap < 0.5) {
    fill = "oklch(62% 0.17 142)"; // green — on track
  } else if (gap <= 1.5) {
    fill = "oklch(80% 0.18 87)"; // yellow — drifting
  } else {
    fill = "oklch(60% 0.22 25)"; // red — behind
  }

  return <circle cx={cx} cy={cy} r={3} fill={fill} stroke="none" />;
}

// ── Custom tooltip ───────────────────────────────────────────

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;

  const data = payload[0]?.payload;
  if (!data) return null;

  const optimal = data.optimal;
  const actual = data.actual;
  const shadow = data.shadow;
  const gap = actual !== null ? (optimal - actual).toFixed(1) : null;
  const dateStr = new Date(data.date + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  return (
    <div
      style={{
        backgroundColor: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: "8px",
        fontSize: "12px",
        color: "var(--card-foreground)",
        padding: "8px 12px",
      }}
    >
      <div className="font-medium mb-1">{dateStr}</div>
      <div className="space-y-0.5 text-[11px]">
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Target VDOT</span>
          <span className="font-mono tabular-nums">{optimal?.toFixed(1)}</span>
        </div>
        {actual !== null && (
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Actual VDOT</span>
            <span className="font-mono tabular-nums">{actual?.toFixed(1)}</span>
          </div>
        )}
        {gap !== null && (
          <div className="flex justify-between gap-4 border-t border-border/50 pt-0.5 mt-0.5">
            <span className="text-muted-foreground">Gap</span>
            <span
              className="font-mono tabular-nums"
              style={{
                color:
                  Number(gap) > 0
                    ? "oklch(60% 0.22 25)"
                    : "oklch(62% 0.17 142)",
              }}
            >
              {Number(gap) > 0 ? "+" : ""}
              {gap}
            </span>
          </div>
        )}
        {shadow != null && (
          <div className="flex justify-between gap-4 border-t border-border/50 pt-0.5 mt-0.5">
            <span className="text-muted-foreground" style={{ color: "oklch(80% 0.15 85)" }}>
              What-if
            </span>
            <span className="font-mono tabular-nums" style={{ color: "oklch(80% 0.15 85)" }}>
              {shadow.toFixed(1)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main chart component ─────────────────────────────────────

export function TrajectoryChart({
  data,
  raceDate,
  today,
  goalVdot,
  shadowData,
  onHoverDate,
}: TrajectoryChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[200px] text-muted-foreground text-sm">
        No trajectory data yet
      </div>
    );
  }

  // Merge shadow data into chart data by date
  const shadowMap = new Map<string, number>();
  if (shadowData) {
    for (const s of shadowData) {
      shadowMap.set(s.date, s.shadow);
    }
  }

  const chartData = data.map((d) => ({
    date: d.date,
    optimal: Number(d.optimal.toFixed(1)),
    actual: d.actual !== null ? Number(Number(d.actual).toFixed(1)) : null,
    shadow: shadowMap.get(d.date) ?? null,
  }));

  // Hover handlers for date emission
  const handleMouseMove = useCallback(
    (state: any) => {
      if (onHoverDate && state?.activeLabel) {
        onHoverDate(state.activeLabel);
      }
    },
    [onHoverDate],
  );

  const handleMouseLeave = useCallback(() => {
    if (onHoverDate) onHoverDate(null);
  }, [onHoverDate]);

  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart
        data={chartData}
        margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--border)"
          opacity={0.3}
          vertical={false}
        />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
          tickLine={false}
          tickFormatter={(d: string) => {
            const dt = new Date(d + "T00:00:00");
            return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          }}
          interval={Math.max(Math.floor(chartData.length / 6), 1)}
        />
        <YAxis
          className="text-[10px]"
          tickLine={false}
          domain={[46, 53]}
          label={{
            value: "VDOT",
            angle: -90,
            position: "insideLeft",
            fontSize: 10,
            fill: "var(--muted-foreground)",
          }}
        />
        <Tooltip content={<CustomTooltip />} />
        <ReferenceLine
          x={today}
          stroke="var(--primary)"
          strokeDasharray="3 3"
          strokeOpacity={0.6}
          label={{
            value: "Today",
            position: "top",
            fontSize: 9,
            fill: "var(--primary)",
          }}
        />
        <ReferenceLine
          x={raceDate}
          stroke="oklch(60% 0.2 300)"
          strokeDasharray="3 3"
          strokeOpacity={0.6}
          label={{
            value: "Race",
            position: "top",
            fontSize: 9,
            fill: "oklch(60% 0.2 300)",
          }}
        />
        <ReferenceLine
          y={52}
          stroke="oklch(62% 0.17 142)"
          strokeDasharray="2 4"
          strokeOpacity={0.4}
          label={{
            value: "A (1:35)",
            position: "right",
            fontSize: 8,
            fill: "oklch(62% 0.17 142)",
          }}
        />
        <ReferenceLine
          y={49}
          stroke="oklch(65% 0.15 250)"
          strokeDasharray="2 4"
          strokeOpacity={0.4}
          label={{
            value: "B (1:40)",
            position: "right",
            fontSize: 8,
            fill: "oklch(65% 0.15 250)",
          }}
        />
        <ReferenceLine
          y={47.5}
          stroke="oklch(80% 0.18 87)"
          strokeDasharray="2 4"
          strokeOpacity={0.4}
          label={{
            value: "C (1:43)",
            position: "right",
            fontSize: 8,
            fill: "oklch(80% 0.18 87)",
          }}
        />
        <Line
          type="monotone"
          dataKey="optimal"
          stroke="oklch(65% 0.15 250)"
          strokeWidth={2}
          strokeDasharray="6 3"
          dot={false}
          name="optimal"
        />
        <Line
          type="monotone"
          dataKey="actual"
          stroke="oklch(62% 0.17 142)"
          strokeWidth={2.5}
          dot={<GapDot />}
          connectNulls
          name="actual"
        />
        {/* Shadow / what-if curve (only rendered when shadow data exists) */}
        {shadowData && shadowData.length > 0 && (
          <Line
            type="monotone"
            dataKey="shadow"
            stroke="oklch(80% 0.15 85)"
            strokeWidth={2}
            strokeDasharray="6 3"
            strokeOpacity={0.5}
            dot={false}
            connectNulls
            name="shadow"
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
