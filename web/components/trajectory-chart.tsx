"use client";

import { useCallback, useState, useEffect } from "react";
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
import { estimateHMSeconds } from "@/lib/vdot-utils";

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

// ── VDOT → pace/time conversions (Daniels/Gilbert) ──────────

function formatSeconds(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function vdotToHmPace(vdot: number): string {
  const hmSeconds = estimateHMSeconds(vdot);
  const paceSecPerKm = hmSeconds / 21.0975;
  const min = Math.floor(paceSecPerKm / 60);
  const sec = Math.round(paceSecPerKm % 60);
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

function formatPace(secPerKm: number): string {
  const min = Math.floor(secPerKm / 60);
  const sec = Math.round(secPerKm % 60);
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

function formatHmTime(vdot: number): string {
  return formatSeconds(estimateHMSeconds(vdot));
}

function formatTimeDelta(seconds: number): string {
  const sign = seconds >= 0 ? "+" : "-";
  const abs = Math.abs(seconds);
  const m = Math.floor(abs / 60);
  const s = Math.round(abs % 60);
  return `${sign}${m}:${String(s).padStart(2, "0")}`;
}

const PROJECTED_COLOR = "oklch(70% 0.18 200)"; // teal — Banister prediction

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

function makeCustomTooltip(projectedDays?: ProjectedDay[] | null, goalVdot?: number, visibleLines?: Set<string>) {
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

    const projectedDay = projectedDays?.find(p => p.dayDate === data.date);

    const hmPaceVisible = !visibleLines || visibleLines.has("hmPace");
    // Use the actual plotted hmPace value (merge-adjusted, from forward simulation)
    const hmPaceSecKm: number | null = data.hmPace;
    // Total HM time from the plotted pace
    const hmTimeSec = hmPaceSecKm != null ? hmPaceSecKm * 21.0975 : null;
    const goalHmSec = goalVdot ? estimateHMSeconds(goalVdot) : null;
    const hmGapSec = hmTimeSec != null && goalHmSec != null ? hmTimeSec - goalHmSec : null;

    return (
      <div
        style={{
          backgroundColor: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: "8px",
          fontSize: "12px",
          color: "var(--card-foreground)",
          padding: "8px 12px",
          maxWidth: 260,
        }}
      >
        <div className="font-medium mb-1">{dateStr}</div>
        <div className="space-y-0.5 text-[11px]">
          {(!visibleLines || visibleLines.has("optimal")) && (
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Banister VDOT</span>
              <span className="font-mono tabular-nums">{optimal?.toFixed(1)}</span>
            </div>
          )}
          {actual !== null && actual !== undefined && (!visibleLines || visibleLines.has("actual")) && (
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Actual VDOT</span>
              <span className="font-mono tabular-nums">{actual?.toFixed(1)}</span>
            </div>
          )}
          {/* projectedVdot merged into optimal — both use full Banister model */}
          {gap !== null && (!visibleLines || (visibleLines.has("optimal") && visibleLines.has("actual"))) && (
            <div className="flex justify-between gap-4 border-t border-border/50 pt-0.5 mt-0.5">
              <span className="text-muted-foreground">Gap (actual)</span>
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
          {shadow != null && (!visibleLines || visibleLines.has("shadow")) && (
            <div className="flex justify-between gap-4 border-t border-border/50 pt-0.5 mt-0.5">
              <span style={{ color: "oklch(80% 0.15 85)" }}>What-if</span>
              <span className="font-mono tabular-nums" style={{ color: "oklch(80% 0.15 85)" }}>
                {shadow.toFixed(1)}
              </span>
            </div>
          )}
          {/* HM race time vs goal */}
          {hmPaceSecKm != null && hmPaceVisible && (
            <div className="border-t border-border/50 pt-1 mt-1 space-y-0.5">
              <div className="flex justify-between gap-4">
                <span style={{ color: HM_PACE_COLOR }}>HM pace</span>
                <span className="font-mono tabular-nums" style={{ color: HM_PACE_COLOR }}>
                  {formatPace(hmPaceSecKm)}/km
                </span>
              </div>
              {hmTimeSec != null && (
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Predicted HM</span>
                  <span className="font-mono tabular-nums font-medium">
                    {formatSeconds(hmTimeSec)}
                  </span>
                </div>
              )}
              {goalVdot != null && (
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Goal HM</span>
                  <span className="font-mono tabular-nums">
                    {formatHmTime(goalVdot)}
                  </span>
                </div>
              )}
              {hmGapSec != null && (
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Gap</span>
                  <span
                    className="font-mono tabular-nums font-medium"
                    style={{
                      color: hmGapSec > 0
                        ? "oklch(60% 0.22 25)"
                        : "oklch(62% 0.17 142)",
                    }}
                  >
                    {formatTimeDelta(hmGapSec)}
                  </span>
                </div>
              )}
            </div>
          )}
          {/* Secondary dimension values */}
          {(
            (data.ctl != null && (!visibleLines || visibleLines.has("ctl"))) ||
            (data.readiness != null && (!visibleLines || visibleLines.has("readiness"))) ||
            (data.weightEffect != null && (!visibleLines || visibleLines.has("weightEffect")))
          ) && (
            <div className="border-t border-border/50 pt-0.5 mt-0.5 space-y-0.5">
              {data.ctl != null && (!visibleLines || visibleLines.has("ctl")) && (
                <div className="flex justify-between gap-4">
                  <span style={{ color: DIM_COLORS.ctl }}>Fitness (CTL)</span>
                  <span className="font-mono tabular-nums" style={{ color: DIM_COLORS.ctl }}>
                    {(data.ctl * 100).toFixed(0)}%
                  </span>
                </div>
              )}
              {data.readiness != null && (!visibleLines || visibleLines.has("readiness")) && (
                <div className="flex justify-between gap-4">
                  <span style={{ color: DIM_COLORS.readiness }}>Readiness</span>
                  <span className="font-mono tabular-nums" style={{ color: DIM_COLORS.readiness }}>
                    {(data.readiness * 100).toFixed(0)}%
                  </span>
                </div>
              )}
              {data.weightEffect != null && (!visibleLines || visibleLines.has("weightEffect")) && (
                <div className="flex justify-between gap-4">
                  <span style={{ color: DIM_COLORS.weightEffect }}>Weight Effect</span>
                  <span className="font-mono tabular-nums" style={{ color: DIM_COLORS.weightEffect }}>
                    {(data.weightEffect * 100).toFixed(0)}%
                  </span>
                </div>
              )}
            </div>
          )}
          {/* Formula breakdown from forward simulation — only when VDOT/pace lines visible */}
          {projectedDay && visibleLines && (visibleLines.has("optimal") || visibleLines.has("actual")) && (
            <div className="mt-1 pt-1 border-t border-border/30 space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Formula</div>
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
        </div>
      </div>
    );
  };
}

// ── Line visibility definitions ──────────────────────────────

const HM_PACE_COLOR = "oklch(70% 0.18 330)"; // pink-purple

const TRAJECTORY_LINES = [
  { key: "optimal", label: "Banister VDOT", color: "oklch(65% 0.15 250)" },
  { key: "actual", label: "Actual VDOT", color: "oklch(62% 0.17 142)" },
  { key: "hmPace", label: "Expected HM pace", color: HM_PACE_COLOR },
  { key: "shadow", label: "What-if", color: "oklch(80% 0.15 85)" },
  { key: "ctl", label: "Fitness (CTL)", color: DIM_COLORS.ctl },
  { key: "readiness", label: "Readiness", color: DIM_COLORS.readiness },
  { key: "weightEffect", label: "Weight Effect", color: DIM_COLORS.weightEffect },
] as const;

function LineVisibilityDropdown({
  visible,
  onToggle,
  availableKeys,
}: {
  visible: Set<string>;
  onToggle: (key: string) => void;
  availableKeys: Set<string>;
}) {
  const [open, setOpen] = useState(false);
  const available = TRAJECTORY_LINES.filter((l) => availableKeys.has(l.key));
  const activeCount = available.filter((l) => visible.has(l.key)).length;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-[11px] px-2 py-0.5 rounded border border-border bg-card text-muted-foreground hover:text-foreground transition-colors"
      >
        Lines ({activeCount}/{available.length})
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
          <div className="absolute right-0 top-full mt-1 z-50 bg-card border border-border rounded-md shadow-lg py-1 min-w-[180px]" onClick={(e) => e.stopPropagation()}>
            {available.map((l) => (
              <label
                key={l.key}
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted/50 cursor-pointer text-[11px]"
              >
                <input
                  type="checkbox"
                  checked={visible.has(l.key)}
                  onChange={() => onToggle(l.key)}
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
  projectedDays,
}: TrajectoryChartProps) {
  const STORAGE_KEY = "trajectory-visible-lines";
  const [visible, setVisible] = useState<Set<string>>(() => {
    const defaults = new Set<string>(TRAJECTORY_LINES.map((l) => l.key));
    if (typeof window === "undefined") return defaults;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        // Filter out removed keys (like projectedVdot which was merged into optimal)
        const validKeys = defaults;
        const filtered = (JSON.parse(saved) as string[]).filter((k) => validKeys.has(k));
        return filtered.length > 0 ? new Set<string>(filtered) : defaults;
      }
    } catch { /* ignore */ }
    return defaults;
  });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...visible])); } catch { /* ignore */ }
  }, [visible]);

  function toggleLine(key: string) {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

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

  // HM pace: derived directly from Banister VDOT (no merge factors —
  // the Banister model already accounts for fatigue via k2 term;
  // merge factors are for per-workout pace adjustments, not trajectory trend)
  const chartData = data.map((d) => {
    let hmPace: number | null = null;
    if (d.optimal > 0) {
      hmPace = Math.round(estimateHMSeconds(d.optimal) / 21.0975);
    }
    return {
      date: d.date,
      optimal: Number(d.optimal.toFixed(1)),
      actual: d.actual !== null ? Number(Number(d.actual).toFixed(1)) : null,
      projectedVdot: d.projectedVdot != null ? Number(Number(d.projectedVdot).toFixed(1)) : null,
      hmPace,
      shadow: shadowMap.get(d.date) ?? null,
      ctl: d.ctl ?? null,
      readiness: d.readiness ?? null,
      weightEffect: d.weightEffect ?? null,
    };
  });

  // Check if we have any secondary dimension data
  const hasCTL = chartData.some((d) => d.ctl !== null);
  const hasReadiness = chartData.some((d) => d.readiness !== null);
  const hasWeightEffect = chartData.some((d) => d.weightEffect !== null);
  const hasSecondary = (hasCTL && visible.has("ctl")) || (hasReadiness && visible.has("readiness")) || (hasWeightEffect && visible.has("weightEffect"));

  // Build set of available line keys (only lines that have data)
  const availableKeys = new Set<string>(["optimal"]);
  if (chartData.some((d) => d.actual !== null)) availableKeys.add("actual");
  if (chartData.some((d) => d.hmPace !== null)) availableKeys.add("hmPace");
  if (shadowData && shadowData.length > 0) availableKeys.add("shadow");
  if (hasCTL) availableKeys.add("ctl");
  if (hasReadiness) availableKeys.add("readiness");
  if (hasWeightEffect) availableKeys.add("weightEffect");

  const showHmPaceAxis = visible.has("hmPace") && chartData.some((d) => d.hmPace !== null);

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

  // Race-day fitness VDOT for annotation (performance potential)
  const raceDayEntry = chartData.find((d) => d.date === raceDate);
  const raceDayProjectedVdot = raceDayEntry?.optimal ?? null;

  // Goal VDOT tiers — A = goalVdot prop, B and C are progressively easier
  const goalA = goalVdot;
  const goalB = goalVdot - 2;
  const goalC = goalVdot - 3.5;

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
    <div>
    <div className="flex justify-end mb-1" onClick={(e) => e.stopPropagation()}>
      <LineVisibilityDropdown visible={visible} onToggle={toggleLine} availableKeys={availableKeys} />
    </div>
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart
        data={chartData}
        margin={{ top: 18, right: (hasSecondary || showHmPaceAxis) ? 50 : 20, left: 0, bottom: 5 }}
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
          domain={["auto", "auto"]}
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
        {/* Pace Y-axis (sec/km) — reversed so faster pace is higher */}
        {showHmPaceAxis && (
          <YAxis
            yAxisId="pace"
            orientation="right"
            tick={hasSecondary ? false : { fontSize: 9, fill: HM_PACE_COLOR }}
            tickLine={false}
            reversed
            domain={["dataMin - 5", "dataMax + 5"]}
            tickFormatter={(v: number) => {
              const m = Math.floor(v / 60);
              const s = Math.round(v % 60);
              return `${m}:${String(s).padStart(2, "0")}`;
            }}
            width={hasSecondary ? 0 : 40}
          />
        )}
        <Tooltip content={makeCustomTooltip(projectedDays, goalVdot, visible)} />

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
            value: `A (${formatHmTime(goalA)})`,
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
            value: `B (${formatHmTime(goalB)})`,
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
            value: `C (${formatHmTime(goalC)})`,
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
        {visible.has("optimal") && (
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
        )}

        {/* Actual VDOT — per-segment gradient coloring via custom shape */}
        {visible.has("actual") && (
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
        )}

        {/* projectedVdot merged into optimal — both use same Banister model */}

        {/* Shadow / what-if curve (only rendered when shadow data exists) */}
        {visible.has("shadow") && shadowData && shadowData.length > 0 && (
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
        {visible.has("actual") && youAreHereDate && youAreHereVdot != null && (
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

        {/* Race-day predicted HM time annotation */}
        {visible.has("optimal") && raceDayProjectedVdot != null && (
          <ReferenceDot
            yAxisId="vdot"
            x={raceDate}
            y={raceDayProjectedVdot}
            r={5}
            fill="oklch(65% 0.15 250)"
            stroke="white"
            strokeWidth={1.5}
            label={{
              value: `HM ≈ ${formatHmTime(raceDayProjectedVdot)}`,
              position: "left",
              fontSize: 9,
              fill: "oklch(65% 0.15 250)",
              fontWeight: 600,
              offset: 8,
            }}
          />
        )}

        {/* ── Expected HM pace line ── */}
        {showHmPaceAxis && (
          <Line
            yAxisId="pace"
            type="monotone"
            dataKey="hmPace"
            stroke={HM_PACE_COLOR}
            strokeWidth={2}
            dot={false}
            connectNulls
            name="Expected HM pace"
          />
        )}

        {/* ── Secondary dimension lines (thin, semi-transparent) ── */}
        {hasCTL && visible.has("ctl") && (
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
        {hasReadiness && visible.has("readiness") && (
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
        {hasWeightEffect && visible.has("weightEffect") && (
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
    </div>
  );
}
