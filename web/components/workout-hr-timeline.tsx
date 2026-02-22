"use client";

import { useState, useMemo, useCallback } from "react";
import {
  ComposedChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
  ReferenceLine,
} from "recharts";

// --- Types ---

interface HrPoint {
  elapsed_sec: number;
  hr: number;
}

interface ExerciseSet {
  exercise: string | null;
  start_sec: number;
  duration_sec: number;
  reps: number;
  weight: number;
  set_type: string;
}

interface HrZone {
  zone: number;
  seconds: number;
  low: number;
  high: number;
}

interface WorkoutHrTimelineProps {
  hrTimeline: HrPoint[];
  exerciseSets?: ExerciseSet[];
  hrZones?: HrZone[];
}

// --- Constants ---

const EXERCISE_COLORS = [
  "#60a5fa", "#f97316", "#4ade80", "#f472b6", "#a78bfa",
  "#facc15", "#38bdf8", "#ef4444", "#34d399", "#fb923c",
];

const ZONE_CONFIG: Record<number, { color: string; label: string }> = {
  1: { color: "#9ca3af", label: "Warm Up" },
  2: { color: "#60a5fa", label: "Easy" },
  3: { color: "#4ade80", label: "Aerobic" },
  4: { color: "#f97316", label: "Threshold" },
  5: { color: "#ef4444", label: "Maximum" },
};

const DEFAULT_ZONES: HrZone[] = [
  { zone: 1, seconds: 0, low: 0, high: 104 },
  { zone: 2, seconds: 0, low: 105, high: 119 },
  { zone: 3, seconds: 0, low: 120, high: 139 },
  { zone: 4, seconds: 0, low: 140, high: 159 },
  { zone: 5, seconds: 0, low: 160, high: 220 },
];

// Fixed YAxis width for consistent alignment with exercise bar
const Y_AXIS_WIDTH = 36;
const CHART_MARGIN = { top: 5, right: 10, bottom: 0, left: 0 };
// Exercise bar left offset = YAxis width + left margin
const BAR_LEFT = Y_AXIS_WIDTH + CHART_MARGIN.left;

// --- Utilities ---

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  return `${m}m`;
}

function buildExerciseColorMap(sets: ExerciseSet[]): Map<string, string> {
  const map = new Map<string, string>();
  let colorIdx = 0;
  for (const s of sets) {
    if ((s.set_type === "ACTIVE" || s.set_type === "WARMUP") && s.exercise && !map.has(s.exercise)) {
      map.set(s.exercise, EXERCISE_COLORS[colorIdx % EXERCISE_COLORS.length]);
      colorIdx++;
    }
  }
  return map;
}

function getZoneInfo(hr: number, zones: HrZone[]): { zone: number; label: string; color: string } {
  for (const z of zones) {
    if (hr >= z.low && hr <= z.high) {
      const config = ZONE_CONFIG[z.zone] || { color: "#888", label: `Zone ${z.zone}` };
      return { zone: z.zone, ...config };
    }
  }
  return { zone: 0, label: "", color: "#888" };
}

// --- Exercise Block Grouping ---

interface ExerciseBlock {
  exercise: string;
  color: string;
  startSec: number;
  endSec: number;
  sets: ExerciseSet[];
}

function groupExerciseBlocks(sets: ExerciseSet[], colorMap: Map<string, string>): ExerciseBlock[] {
  const blocks: ExerciseBlock[] = [];
  let current: ExerciseBlock | null = null;

  for (const s of sets) {
    if (s.set_type === "REST") continue;
    const name = s.exercise || "Unknown";

    if (current && name === current.exercise) {
      current.endSec = s.start_sec + s.duration_sec;
      current.sets.push(s);
    } else {
      if (current) blocks.push(current);
      current = {
        exercise: name,
        color: colorMap.get(name) || "#888",
        startSec: s.start_sec,
        endSec: s.start_sec + s.duration_sec,
        sets: [s],
      };
    }
  }
  if (current) blocks.push(current);
  return blocks;
}

// --- Custom Tooltip ---

function UnifiedTooltip({ active, payload, exerciseSets, zones }: any) {
  if (!active || !payload?.[0]) return null;
  const point = payload[0].payload;
  const elapsedSec = point.elapsed_sec;
  const hr = point.hr;
  const zoneInfo = getZoneInfo(hr, zones);

  let exerciseName = "";
  let setInfo = "";
  let weightReps = "";

  if (exerciseSets) {
    const workingSets = exerciseSets.filter(
      (s: ExerciseSet) => s.set_type === "ACTIVE" || s.set_type === "WARMUP"
    );
    const totalByExercise: Record<string, number> = {};
    for (const s of workingSets) {
      const name = s.exercise || "Unknown";
      totalByExercise[name] = (totalByExercise[name] || 0) + 1;
    }

    const setCountByExercise: Record<string, number> = {};
    for (const s of workingSets) {
      const name = s.exercise || "Unknown";
      setCountByExercise[name] = (setCountByExercise[name] || 0) + 1;
      if (elapsedSec >= s.start_sec && elapsedSec <= s.start_sec + s.duration_sec) {
        exerciseName = s.exercise || "Unknown";
        const isWarmup = s.set_type === "WARMUP";
        setInfo = isWarmup
          ? "Warmup"
          : `Set ${setCountByExercise[name]}/${totalByExercise[name]}`;
        if (s.weight > 0) {
          weightReps = `${s.weight} kg \u00d7 ${s.reps} reps`;
        } else if (s.reps > 0) {
          weightReps = `${s.reps} reps`;
        }
        break;
      }
    }

    // If hovering in a gap, show the nearest exercise for context
    if (!exerciseName && workingSets.length > 0) {
      let closest: ExerciseSet | null = null;
      let minDist = Infinity;
      for (const s of workingSets) {
        const mid = s.start_sec + s.duration_sec / 2;
        const dist = Math.abs(elapsedSec - mid);
        if (dist < minDist) { minDist = dist; closest = s; }
      }
      if (closest) {
        exerciseName = closest.exercise || "Unknown";
        setInfo = "Rest";
      }
    }
  }

  return (
    <div className="bg-card text-card-foreground border border-border rounded-lg p-2.5 text-xs shadow-lg min-w-[140px]">
      <div className="flex items-center gap-2">
        <span className="text-base font-bold" style={{ color: zoneInfo.color }}>
          {hr}
        </span>
        <span className="text-muted-foreground">bpm</span>
        {zoneInfo.label && (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded font-medium"
            style={{ backgroundColor: zoneInfo.color + "20", color: zoneInfo.color }}
          >
            Z{zoneInfo.zone} {zoneInfo.label}
          </span>
        )}
      </div>

      {exerciseName && (
        <div className="border-t border-border/50 pt-1.5 mt-1.5 space-y-0.5">
          <div className="font-medium">{exerciseName}</div>
          {setInfo && <div className="text-muted-foreground">{setInfo}</div>}
          {weightReps && <div>{weightReps}</div>}
        </div>
      )}

      <div className="text-muted-foreground mt-1">{formatElapsed(elapsedSec)}</div>
    </div>
  );
}

// --- Main Component ---

export function WorkoutHrTimeline({ hrTimeline, exerciseSets, hrZones }: WorkoutHrTimelineProps) {
  const [hoveredTime, setHoveredTime] = useState<number | null>(null);
  const [hoveredGanttBlock, setHoveredGanttBlock] = useState<{
    block: ExerciseBlock;
    x: number;
    y: number;
  } | null>(null);

  const zones = hrZones && hrZones.length > 0 ? hrZones : DEFAULT_ZONES;

  const exerciseColorMap = useMemo(
    () => (exerciseSets ? buildExerciseColorMap(exerciseSets) : new Map()),
    [exerciseSets]
  );

  const exerciseBlocks = useMemo(
    () => (exerciseSets ? groupExerciseBlocks(exerciseSets, exerciseColorMap) : []),
    [exerciseSets, exerciseColorMap]
  );

  const activeSets = useMemo(
    () => (exerciseSets || []).filter((s) => s.set_type === "ACTIVE" || s.set_type === "WARMUP"),
    [exerciseSets]
  );

  const hrs = hrTimeline.map((p) => p.hr);
  const dataMinHr = Math.min(...hrs);
  const dataMaxHr = Math.max(...hrs);
  // Round to nice tick boundaries
  const yMin = Math.floor(Math.max(dataMinHr - 10, 40) / 10) * 10;
  const yMax = Math.ceil(Math.min(dataMaxHr + 10, 220) / 10) * 10;

  const yTicks = useMemo(() => {
    const range = yMax - yMin;
    const step = range > 80 ? 20 : 10;
    const ticks: number[] = [];
    for (let v = yMin; v <= yMax; v += step) ticks.push(v);
    return ticks;
  }, [yMin, yMax]);

  const totalDuration =
    hrTimeline.length > 0 ? hrTimeline[hrTimeline.length - 1].elapsed_sec : 0;

  const visibleZones = zones.filter((z) => z.high >= yMin && z.low <= yMax);

  // Zone-colored gradient stops (vertical: top=yMax, bottom=yMin)
  const gradientStops = useMemo(() => {
    const stops: Array<{ offset: number; color: string }> = [];
    const sorted = [...zones].sort((a, b) => b.high - a.high);
    for (const z of sorted) {
      const config = ZONE_CONFIG[z.zone];
      if (!config) continue;
      const highOff = Math.max(0, Math.min(1, (yMax - Math.min(z.high, yMax)) / (yMax - yMin)));
      const lowOff = Math.max(0, Math.min(1, (yMax - Math.max(z.low, yMin)) / (yMax - yMin)));
      stops.push({ offset: highOff, color: config.color });
      stops.push({ offset: lowOff, color: config.color });
    }
    return stops;
  }, [zones, yMin, yMax]);

  // Average HR for reference line
  const avgHr = useMemo(() => {
    if (hrTimeline.length === 0) return null;
    return Math.round(hrTimeline.reduce((s, p) => s + p.hr, 0) / hrTimeline.length);
  }, [hrTimeline]);

  // Per-block avg HR for Gantt tooltip
  const blockAvgHrs = useMemo(() => {
    if (!exerciseSets || hrTimeline.length === 0) return new Map<number, number>();
    const map = new Map<number, number>();
    exerciseBlocks.forEach((block, i) => {
      const samples = hrTimeline.filter(
        (p) => p.elapsed_sec >= block.startSec && p.elapsed_sec <= block.endSec
      );
      if (samples.length > 0) {
        map.set(i, Math.round(samples.reduce((s, p) => s + p.hr, 0) / samples.length));
      }
    });
    return map;
  }, [exerciseBlocks, hrTimeline, exerciseSets]);

  // Set boundary times for reference lines on chart
  const setBoundaries = useMemo(() => {
    if (activeSets.length === 0) return [];
    const boundaries: Array<{ time: number; color: string; isExerciseBoundary: boolean }> = [];
    for (let i = 0; i < activeSets.length - 1; i++) {
      const s = activeSets[i];
      const next = activeSets[i + 1];
      const boundaryTime = s.start_sec + s.duration_sec;
      const sameExercise = s.exercise === next.exercise;
      boundaries.push({
        time: boundaryTime,
        color: exerciseColorMap.get(s.exercise || "") || "#888",
        isExerciseBoundary: !sameExercise,
      });
    }
    return boundaries;
  }, [activeSets, exerciseColorMap]);

  const handleMouseMove = useCallback((state: any) => {
    if (state?.activePayload?.[0]) {
      setHoveredTime(state.activePayload[0].payload.elapsed_sec);
    }
  }, []);

  const handleMouseLeave = useCallback(() => {
    setHoveredTime(null);
  }, []);

  const hoveredBlock =
    hoveredTime != null
      ? exerciseBlocks.find((b) => hoveredTime >= b.startSec && hoveredTime <= b.endSec)
      : null;

  return (
    <div>
      {/* HR Chart */}
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart
          data={hrTimeline}
          margin={CHART_MARGIN}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          <defs>
            <linearGradient id="hrZoneGradient" x1="0" y1="0" x2="0" y2="1">
              {gradientStops.map((s, i) => (
                <stop key={i} offset={`${s.offset * 100}%`} stopColor={s.color} stopOpacity={1} />
              ))}
            </linearGradient>
            <linearGradient id="hrZoneGradientFill" x1="0" y1="0" x2="0" y2="1">
              {gradientStops.map((s, i) => (
                <stop key={i} offset={`${s.offset * 100}%`} stopColor={s.color} stopOpacity={0.08} />
              ))}
            </linearGradient>
          </defs>

          {/* Exercise fills (vertical bands) */}
          {activeSets.map((s, i) => (
            <ReferenceArea
              key={`set-${i}`}
              x1={s.start_sec}
              x2={s.start_sec + s.duration_sec}
              fill={exerciseColorMap.get(s.exercise || "") || "#888"}
              fillOpacity={
                hoveredBlock && s.exercise === hoveredBlock.exercise ? 0.25 : 0.15
              }
              ifOverflow="hidden"
              stroke="none"
            />
          ))}

          {/* Set boundary lines within exercises */}
          {setBoundaries.map((b, i) => (
            <ReferenceLine
              key={`setbound-${i}`}
              x={b.time}
              stroke={b.color}
              strokeDasharray={b.isExerciseBoundary ? undefined : "3 3"}
              strokeOpacity={b.isExerciseBoundary ? 0.4 : 0.25}
              strokeWidth={b.isExerciseBoundary ? 1 : 0.5}
            />
          ))}

          {/* Zone boundary lines (dashes) */}
          {visibleZones.slice(0, -1).map((z) => (
            <ReferenceLine
              key={`zline-${z.zone}`}
              y={z.high}
              stroke={ZONE_CONFIG[z.zone]?.color || "#888"}
              strokeDasharray="4 4"
              strokeOpacity={0.35}
            />
          ))}

          {/* Avg HR reference line */}
          {avgHr !== null && (
            <ReferenceLine
              y={avgHr}
              stroke="rgba(255,255,255,0.4)"
              strokeDasharray="6 4"
              strokeWidth={1}
              label={{
                value: "avg",
                position: "right",
                fill: "rgba(255,255,255,0.5)",
                fontSize: 9,
              }}
            />
          )}

          <XAxis
            dataKey="elapsed_sec"
            className="text-[10px]"
            tickLine={false}
            axisLine={false}
            tickFormatter={formatElapsed}
            interval="preserveStartEnd"
            minTickGap={50}
          />
          <YAxis
            width={Y_AXIS_WIDTH}
            className="text-[10px]"
            domain={[yMin, yMax]}
            ticks={yTicks}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `${v}`}
          />
          <Tooltip
            cursor={{ stroke: "rgba(255,255,255,0.3)", strokeWidth: 1 }}
            content={<UnifiedTooltip exerciseSets={exerciseSets} zones={zones} />}
          />
          <Area
            type="monotone"
            dataKey="hr"
            stroke="url(#hrZoneGradient)"
            strokeWidth={2}
            fill="url(#hrZoneGradientFill)"
            dot={false}
            activeDot={{ r: 3, fill: "#fff", stroke: "rgba(255,255,255,0.5)" }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>

      {/* Exercise Gantt Bar */}
      {exerciseBlocks.length > 0 && totalDuration > 0 && (
        <div
          className="relative h-8 mt-0.5"
          style={{ marginLeft: BAR_LEFT, marginRight: CHART_MARGIN.right }}
        >
          {exerciseBlocks.map((block, i) => {
            const left = (block.startSec / totalDuration) * 100;
            const width = ((block.endSec - block.startSec) / totalDuration) * 100;
            const isHovered = hoveredBlock === block || hoveredGanttBlock?.block === block;

            return (
              <div
                key={i}
                className="absolute top-0 bottom-0 rounded-sm overflow-hidden flex items-center transition-opacity duration-100 cursor-pointer"
                style={{
                  left: `${left}%`,
                  width: `${width}%`,
                  backgroundColor: block.color,
                  opacity: isHovered ? 0.95 : 0.55,
                }}
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setHoveredGanttBlock({
                    block,
                    x: rect.left + rect.width / 2,
                    y: rect.top,
                  });
                }}
                onMouseLeave={() => setHoveredGanttBlock(null)}
              >
                {/* Set dividers */}
                {block.sets.length > 1 &&
                  block.sets.slice(1).map((s, si) => {
                    const setOffset =
                      ((s.start_sec - block.startSec) / (block.endSec - block.startSec)) * 100;
                    return (
                      <div
                        key={si}
                        className="absolute top-1 bottom-1"
                        style={{
                          left: `${setOffset}%`,
                          width: 1,
                          backgroundColor: "rgba(0,0,0,0.3)",
                        }}
                      />
                    );
                  })}

                {/* Exercise name */}
                <span
                  className="text-[9px] font-medium text-white truncate px-1 relative z-10"
                  style={{ textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}
                >
                  {block.exercise}
                </span>
              </div>
            );
          })}

          {/* Hover crosshair on exercise bar */}
          {hoveredTime != null && (
            <div
              className="absolute top-0 bottom-0 w-px bg-white/30 pointer-events-none"
              style={{ left: `${(hoveredTime / totalDuration) * 100}%` }}
            />
          )}
        </div>
      )}

      {/* Gantt bar hover tooltip */}
      {hoveredGanttBlock && (
        <div
          className="fixed z-50 bg-card text-card-foreground border border-border rounded-lg p-2.5 text-xs shadow-lg pointer-events-none"
          style={{
            left: hoveredGanttBlock.x,
            top: hoveredGanttBlock.y - 8,
            transform: "translate(-50%, -100%)",
          }}
        >
          <div className="font-medium text-sm mb-1">{hoveredGanttBlock.block.exercise}</div>
          <div className="space-y-0.5 text-muted-foreground">
            <div>{hoveredGanttBlock.block.sets.length} sets</div>
            {(() => {
              const weights = hoveredGanttBlock.block.sets
                .filter((s) => s.weight > 0)
                .map((s) => s.weight);
              if (weights.length === 0) return <div>Bodyweight</div>;
              const min = Math.min(...weights);
              const max = Math.max(...weights);
              return <div>{min === max ? `${min} kg` : `${min}-${max} kg`}</div>;
            })()}
            <div>
              {formatElapsed(hoveredGanttBlock.block.startSec)} – {formatElapsed(hoveredGanttBlock.block.endSec)}
            </div>
            {blockAvgHrs.has(exerciseBlocks.indexOf(hoveredGanttBlock.block)) && (
              <div className="text-red-400">
                Avg HR: {blockAvgHrs.get(exerciseBlocks.indexOf(hoveredGanttBlock.block))} bpm
              </div>
            )}
          </div>
        </div>
      )}

      {/* Compact zone legend */}
      {visibleZones.length > 0 && (
        <div className="flex gap-3 mt-2 px-1">
          {visibleZones.map((z) => {
            const config = ZONE_CONFIG[z.zone];
            if (!config) return null;
            return (
              <div key={z.zone} className="flex items-center gap-1 text-[9px] text-muted-foreground">
                <div
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: config.color }}
                />
                <span>Z{z.zone} {config.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
