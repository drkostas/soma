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
  ReferenceArea,
  ReferenceDot,
  Customized,
} from "recharts";
import type { ProjectedDay } from "@/lib/forward-simulation";

interface TrajectoryEntry {
  date: string;
  optimal: number;
  actual: number | null;
  projectedVdot?: number | null;
  ctl?: number | null;
  readiness?: number | null;
  weightEffect?: number | null;
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
  /** Projected days from forward simulation — used for formula breakdown in tooltip */
  projectedDays?: ProjectedDay[] | null;
}

// ── VDOT → pace conversion (Daniels approximation) ──────────
// Returns HM pace as "M:SS /km" string
function vdotToHmPace(vdot: number): string {
  // Approximate HM time in minutes from VDOT (Daniels tables curve fit)
  // HM_min ≈ 210000 / vdot / 60 — simplified from Daniels regression
  const hmSeconds = 210000 / vdot;
  const paceSecPerKm = hmSeconds / 21.0975;
  const min = Math.floor(paceSecPerKm / 60);
  const sec = Math.round(paceSecPerKm % 60);
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

// ── Colors for secondary dimension lines ─────────────────────

const DIM_COLORS = {
  ctl: "oklch(65% 0.15 200)",        // blue-ish — fitness / CTL
  readiness: "oklch(65% 0.15 142)",   // green-ish — readiness composite
  weightEffect: "oklch(65% 0.12 50)", // warm — weight effect
} as const;

// ── Gap color utility ────────────────────────────────────────

function gapColor(actual: number, optimal: number): string {
  const gap = actual - optimal;
  if (gap >= -0.5) return "oklch(62% 0.17 142)";     // green — on track
  if (gap >= -1.5) return "oklch(80% 0.18 87)";      // yellow — drifting
  return "oklch(60% 0.22 25)";                         // red — behind
}

// ── Gap-colored dot for the actual line ──────────────────────

function GapDot(props: any) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null || payload?.actual == null) return null;

  return (
    <circle
      cx={cx}
      cy={cy}
      r={3}
      fill={gapColor(payload.actual, payload.optimal)}
      stroke="none"
    />
  );
}

// ── Custom active line — renders per-segment gradient ────────

function GradientActiveLine(props: any) {
  const { points, data } = props;
  if (!points || points.length < 2) return null;

  const segments: React.ReactElement[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    // Skip segments where either point has null actual
    if (p1.y == null || p2.y == null) continue;

    const d1 = data?.[i];
    const d2 = data?.[i + 1];
    if (!d1 || !d2 || d1.actual == null || d2.actual == null) continue;

    // Use the worse (more behind) gap of the two points for the segment color
    const gap1 = d1.actual - d1.optimal;
    const gap2 = d2.actual - d2.optimal;
    const worstGap = Math.min(gap1, gap2);
    const color =
      worstGap >= -0.5
        ? "oklch(62% 0.17 142)"
        : worstGap >= -1.5
          ? "oklch(80% 0.18 87)"
          : "oklch(60% 0.22 25)";

    segments.push(
      <line
        key={i}
        x1={p1.x}
        y1={p1.y}
        x2={p2.x}
        y2={p2.y}
        stroke={color}
        strokeWidth={2.5}
        strokeLinecap="round"
      />,
    );
  }

  return <g>{segments}</g>;
}

// ── Custom tooltip ───────────────────────────────────────────

function makeCustomTooltip(projectedDays?: ProjectedDay[] | null) {
  return function CustomTooltip({ active, payload }: any) {
    if (!active || !payload?.length) return null;

    const data = payload[0]?.payload;
    if (!data) return null;

    const optimal = data.optimal;
    const actual = data.actual;
    const projected = data.projectedVdot;
    const shadow = data.shadow;
    const gap = actual !== null && actual !== undefined ? (optimal - actual).toFixed(1) : null;
    const dateStr = new Date(data.date + "T00:00:00").toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });

    // Look up forward-simulation projected day for formula breakdown
    const projectedDay = projectedDays?.find(p => p.dayDate === data.date);

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
          {actual !== null && actual !== undefined && (
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
          {projected != null && actual == null && (
            <div className="flex justify-between gap-4 border-t border-border/50 pt-0.5 mt-0.5">
              <span style={{ color: "oklch(62% 0.12 142)" }}>Projected</span>
              <span className="font-mono tabular-nums" style={{ color: "oklch(62% 0.12 142)" }}>
                {projected.toFixed(1)}
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
          {/* Secondary dimension values */}
          {(data.ctl != null || data.readiness != null || data.weightEffect != null) && (
            <div className="border-t border-border/50 pt-0.5 mt-0.5 space-y-0.5">
              {data.ctl != null && (
                <div className="flex justify-between gap-4">
                  <span style={{ color: DIM_COLORS.ctl }}>Fitness (CTL)</span>
                  <span className="font-mono tabular-nums" style={{ color: DIM_COLORS.ctl }}>
                    {(data.ctl * 100).toFixed(0)}%
                  </span>
                </div>
              )}
              {data.readiness != null && (
                <div className="flex justify-between gap-4">
                  <span style={{ color: DIM_COLORS.readiness }}>Readiness</span>
                  <span className="font-mono tabular-nums" style={{ color: DIM_COLORS.readiness }}>
                    {(data.readiness * 100).toFixed(0)}%
                  </span>
                </div>
              )}
              {data.weightEffect != null && (
                <div className="flex justify-between gap-4">
                  <span style={{ color: DIM_COLORS.weightEffect }}>Weight Effect</span>
                  <span className="font-mono tabular-nums" style={{ color: DIM_COLORS.weightEffect }}>
                    {(data.weightEffect * 100).toFixed(0)}%
                  </span>
                </div>
              )}
            </div>
          )}
          {/* Formula breakdown from forward simulation */}
          {projectedDay && (
            <div className="mt-2 pt-2 border-t border-border/30 space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Formula Breakdown</div>
              <div className="text-xs grid grid-cols-2 gap-x-3 gap-y-0.5">
                <span className="text-muted-foreground">Readiness</span>
                <span className="font-mono">{projectedDay.readinessFactor.toFixed(4)}x</span>
                <span className="text-muted-foreground">Fatigue</span>
                <span className="font-mono">{projectedDay.fatigueFactor.toFixed(4)}x</span>
                <span className="text-muted-foreground">Weight</span>
                <span className="font-mono">{projectedDay.weightFactor.toFixed(4)}x</span>
                <span className="text-muted-foreground">Combined</span>
                <span className="font-mono font-bold">{projectedDay.combinedFactor.toFixed(4)}x</span>
              </div>
              <div className="text-xs">
                <span className="text-muted-foreground">Traffic light: </span>
                <span className={
                  projectedDay.trafficLight === "green" ? "text-green-400"
                  : projectedDay.trafficLight === "yellow" ? "text-yellow-400"
                  : "text-red-400"
                }>
                  {projectedDay.trafficLight.toUpperCase()}
                </span>
              </div>
            </div>
          )}
          {/* VDOT → pace explainer */}
          {(actual != null || optimal != null) && (
            <p className="text-[10px] text-muted-foreground mt-1 border-t border-border/50 pt-1">
              VDOT {(actual ?? optimal).toFixed(1)} ≈ {vdotToHmPace(actual ?? optimal)}/km HM pace
            </p>
          )}
        </div>
      </div>
    );
  };
}

// ── Main chart component ─────────────────────────────────────

export function TrajectoryChart({
  data,
  raceDate,
  today,
  goalVdot,
  shadowData,
  onHoverDate,
  projectedDays,
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
    projectedVdot: d.projectedVdot != null ? Number(Number(d.projectedVdot).toFixed(1)) : null,
    shadow: shadowMap.get(d.date) ?? null,
    ctl: d.ctl ?? null,
    readiness: d.readiness ?? null,
    weightEffect: d.weightEffect ?? null,
  }));

  // Check if we have any secondary dimension data
  const hasCTL = chartData.some((d) => d.ctl !== null);
  const hasReadiness = chartData.some((d) => d.readiness !== null);
  const hasWeightEffect = chartData.some((d) => d.weightEffect !== null);
  const hasSecondary = hasCTL || hasReadiness || hasWeightEffect;

  // "You Are Here" — find the current VDOT at or nearest to today
  const todayEntry = chartData.find((d) => d.date === today);
  // Find the most recent actual VDOT on or before today
  const pastActuals = chartData.filter((d) => d.date <= today && d.actual !== null);
  const currentActual = pastActuals.length > 0 ? pastActuals[pastActuals.length - 1] : null;
  const youAreHereVdot = todayEntry?.actual ?? currentActual?.actual ?? null;
  const youAreHereDate = todayEntry?.actual != null ? today : currentActual?.date ?? null;
  const gapToGoal = youAreHereVdot != null ? (goalVdot - youAreHereVdot) : null;

  // Compute taper start date: 12 days before race date
  const raceMs = new Date(raceDate + "T00:00:00").getTime();
  const taperStartMs = raceMs - 12 * 86400000;
  const taperStartDate = new Date(taperStartMs).toISOString().split("T")[0];
  // Only show taper region if it falls within chart range
  const chartDates = chartData.map((d) => d.date);
  const showTaper = chartDates.includes(raceDate) || chartDates[chartDates.length - 1] >= taperStartDate;

  // S-curve inflection point at 40% of plan duration: S(t) = 1/(1+e^{-8(t-0.4)})
  const planStartMs = new Date(chartData[0].date + "T00:00:00").getTime();
  const planDurationMs = raceMs - planStartMs;
  const inflectionMs = planStartMs + planDurationMs * 0.4;
  const inflectionDate = new Date(inflectionMs).toISOString().split("T")[0];
  // Find the optimal VDOT at the inflection point (nearest date)
  const inflectionEntry = chartData.reduce((best, d) => {
    const dMs = new Date(d.date + "T00:00:00").getTime();
    const bestMs = new Date(best.date + "T00:00:00").getTime();
    return Math.abs(dMs - inflectionMs) < Math.abs(bestMs - inflectionMs) ? d : best;
  });
  const inflectionVdot = inflectionEntry?.optimal ?? null;

  // Goal VDOT tiers (hardcoded to match existing reference lines)
  const goalA = 52;
  const goalB = 49;
  const goalC = 47.5;

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
        margin={{ top: 18, right: hasSecondary ? 40 : 20, left: 0, bottom: 5 }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--border)"
          opacity={0.3}
          vertical={false}
        />
        {/* VDOT explanation annotation */}
        <Customized
          component={() => (
            <text x={50} y={14} className="text-[9px] fill-muted-foreground" opacity={0.6}>
              Higher VDOT = faster race pace
            </text>
          )}
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
          yAxisId="vdot"
          className="text-[10px]"
          tickLine={false}
          domain={[46, 53]}
          label={{
            value: "VDOT (Daniels index)",
            angle: -90,
            position: "insideLeft",
            fontSize: 10,
            fill: "var(--muted-foreground)",
            offset: -5,
          }}
        />
        {/* Secondary Y-axis for normalized 0-1 dimensions */}
        {hasSecondary && (
          <YAxis
            yAxisId="norm"
            orientation="right"
            domain={[0, 1]}
            tick={{ fontSize: 9, fill: "var(--muted-foreground)" }}
            tickLine={false}
            tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
            width={35}
          />
        )}
        <Tooltip content={makeCustomTooltip(projectedDays)} />

        {/* Taper region annotation */}
        {showTaper && (
          <ReferenceArea
            yAxisId="vdot"
            x1={taperStartDate}
            x2={raceDate}
            fill="oklch(65% 0.08 250)"
            fillOpacity={0.1}
            label={{
              value: "Taper",
              position: "insideTop",
              fontSize: 9,
              fill: "oklch(65% 0.12 250)",
            }}
          />
        )}

        {/* Today line — prominent vertical indicator */}
        <ReferenceLine
          yAxisId="vdot"
          x={today}
          stroke="oklch(80% 0.2 85)"
          strokeWidth={2}
          strokeOpacity={0.7}
          label={{
            value: "Today",
            position: "top",
            fontSize: 10,
            fill: "oklch(80% 0.2 85)",
            fontWeight: 600,
          }}
        />
        <ReferenceLine
          yAxisId="vdot"
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
        {/* ── Goal zone bands (subtle horizontal areas) ── */}
        <ReferenceArea
          yAxisId="vdot"
          y1={goalA}
          y2={goalB}
          fill="oklch(65% 0.08 142)"
          fillOpacity={0.06}
          label={{
            value: "A goal zone",
            position: "insideTopRight",
            fontSize: 8,
            fill: "oklch(62% 0.12 142)",
          }}
        />
        <ReferenceArea
          yAxisId="vdot"
          y1={goalB}
          y2={goalC}
          fill="oklch(65% 0.08 87)"
          fillOpacity={0.06}
          label={{
            value: "B goal zone",
            position: "insideTopRight",
            fontSize: 8,
            fill: "oklch(65% 0.12 87)",
          }}
        />
        {/* Goal tier lines at the boundaries */}
        <ReferenceLine
          yAxisId="vdot"
          y={goalA}
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
          yAxisId="vdot"
          y={goalB}
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
          yAxisId="vdot"
          y={goalC}
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

        {/* S-curve inflection marker at 40% of plan duration */}
        {inflectionVdot != null && (
          <ReferenceDot
            yAxisId="vdot"
            x={inflectionEntry.date}
            y={inflectionVdot}
            r={0}
            label={{
              value: "S-curve inflection",
              position: "top",
              fill: "oklch(60% 0.1 250)",
              fontSize: 9,
            }}
          />
        )}

        {/* Optimal VDOT — dashed line */}
        <Line
          yAxisId="vdot"
          type="monotone"
          dataKey="optimal"
          stroke="oklch(65% 0.15 250)"
          strokeWidth={2}
          strokeDasharray="6 3"
          dot={false}
          name="optimal"
        />

        {/* Actual VDOT — per-segment gradient coloring via custom shape */}
        <Line
          yAxisId="vdot"
          type="monotone"
          dataKey="actual"
          stroke="oklch(62% 0.17 142)"
          strokeWidth={2.5}
          dot={<GapDot />}
          connectNulls
          name="actual"
          shape={(lineProps: any) => (
            <GradientActiveLine {...lineProps} data={chartData} />
          )}
        />

        {/* Future projection — dotted line from last actual to race day */}
        <Line
          yAxisId="vdot"
          type="monotone"
          dataKey="projectedVdot"
          stroke="oklch(62% 0.12 142)"
          strokeWidth={1.5}
          strokeDasharray="4 4"
          dot={false}
          connectNulls={false}
          name="projected"
        />

        {/* Shadow / what-if curve (only rendered when shadow data exists) */}
        {shadowData && shadowData.length > 0 && (
          <Line
            yAxisId="vdot"
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

        {/* You Are Here — prominent marker at current position */}
        {youAreHereDate && youAreHereVdot != null && (
          <ReferenceDot
            yAxisId="vdot"
            x={youAreHereDate}
            y={youAreHereVdot}
            r={6}
            fill="oklch(80% 0.2 85)"
            stroke="white"
            strokeWidth={2}
            label={{
              value: `VDOT ${youAreHereVdot.toFixed(1)}${gapToGoal != null && gapToGoal > 0 ? ` (gap: ${gapToGoal.toFixed(1)})` : gapToGoal != null ? " ✓ on target" : ""}`,
              position: "top",
              fontSize: 9,
              fill: "oklch(80% 0.2 85)",
              offset: 12,
            }}
          />
        )}

        {/* ── Secondary dimension lines (thin, semi-transparent) ── */}
        {hasCTL && (
          <Line
            yAxisId="norm"
            type="monotone"
            dataKey="ctl"
            stroke={DIM_COLORS.ctl}
            strokeWidth={1}
            strokeOpacity={0.5}
            dot={false}
            connectNulls
            name="CTL"
          />
        )}
        {hasReadiness && (
          <Line
            yAxisId="norm"
            type="monotone"
            dataKey="readiness"
            stroke={DIM_COLORS.readiness}
            strokeWidth={1}
            strokeOpacity={0.5}
            dot={false}
            connectNulls
            name="Readiness"
          />
        )}
        {hasWeightEffect && (
          <Line
            yAxisId="norm"
            type="monotone"
            dataKey="weightEffect"
            stroke={DIM_COLORS.weightEffect}
            strokeWidth={1}
            strokeOpacity={0.5}
            dot={false}
            connectNulls
            name="Weight"
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
