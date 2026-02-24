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

const Y_AXIS_WIDTH = 36;
const CHART_MARGIN = { top: 5, right: 10, bottom: 0, left: 0 };
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

interface ExtendedBlock extends ExerciseBlock {
  fillEnd: number;
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

function UnifiedTooltip({ active, payload, zones, extendedBlocks }: any) {
  if (!active || !payload?.[0]) return null;
  const point = payload[0].payload;
  const elapsedSec = point.elapsed_sec;
  const hr = point.hr;
  const zoneInfo = getZoneInfo(hr, zones);

  let exerciseName = "";
  let setInfo = "";
  let weightReps = "";

  if (extendedBlocks && extendedBlocks.length > 0) {
    // Find which extended block covers this time (no gaps between exercises)
    let matchedBlock: ExtendedBlock | null = null;
    for (const block of extendedBlocks) {
      if (elapsedSec >= block.startSec && elapsedSec < block.fillEnd) {
        matchedBlock = block;
        break;
      }
    }

    if (matchedBlock) {
      exerciseName = matchedBlock.exercise;
      const setsInBlock: ExerciseSet[] = matchedBlock.sets || [];

      // Find nearest set within this block
      let closestSet: ExerciseSet | null = null;
      let minDist = Infinity;
      for (const s of setsInBlock) {
        const mid = s.start_sec + s.duration_sec / 2;
        const dist = Math.abs(elapsedSec - mid);
        if (dist < minDist) { minDist = dist; closestSet = s; }
      }

      if (closestSet) {
        const isWarmup = closestSet.set_type === "WARMUP";
        if (isWarmup) {
          setInfo = "Warmup";
        } else {
          const workingSets = setsInBlock.filter((s) => s.set_type !== "WARMUP");
          const workingIdx = workingSets.indexOf(closestSet);
          setInfo = `Set ${workingIdx + 1}/${workingSets.length}`;
        }
        if (closestSet.weight > 0) {
          weightReps = `${Math.round(closestSet.weight * 10) / 10} kg \u00d7 ${closestSet.reps} reps`;
        } else if (closestSet.reps > 0) {
          weightReps = `${closestSet.reps} reps`;
        }
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
  const [selectedBlockIdx, setSelectedBlockIdx] = useState<number | null>(null);
  // hoveredGanttBlock removed — replaced with inline label style

  const zones = hrZones && hrZones.length > 0 ? hrZones : DEFAULT_ZONES;

  const exerciseColorMap = useMemo(
    () => (exerciseSets ? buildExerciseColorMap(exerciseSets) : new Map()),
    [exerciseSets]
  );

  const exerciseBlocks = useMemo(
    () => (exerciseSets ? groupExerciseBlocks(exerciseSets, exerciseColorMap) : []),
    [exerciseSets, exerciseColorMap]
  );

  const totalDuration =
    hrTimeline.length > 0 ? hrTimeline[hrTimeline.length - 1].elapsed_sec : 0;

  // Extended blocks: each exercise fills from its start to the next exercise's start (no gaps)
  const extendedBlocks: ExtendedBlock[] = useMemo(() => {
    if (exerciseBlocks.length === 0 || totalDuration === 0) return [];
    return exerciseBlocks.map((block, i) => ({
      ...block,
      fillEnd: i < exerciseBlocks.length - 1
        ? exerciseBlocks[i + 1].startSec
        : totalDuration,
    }));
  }, [exerciseBlocks, totalDuration]);

  const hrs = hrTimeline.map((p) => p.hr);
  const dataMinHr = Math.min(...hrs);
  const dataMaxHr = Math.max(...hrs);
  const yMin = Math.floor(Math.max(dataMinHr - 10, 40) / 10) * 10;
  const yMax = Math.ceil(Math.min(dataMaxHr + 10, 220) / 10) * 10;

  const yTicks = useMemo(() => {
    const range = yMax - yMin;
    const step = range > 80 ? 20 : 10;
    const ticks: number[] = [];
    for (let v = yMin; v <= yMax; v += step) ticks.push(v);
    return ticks;
  }, [yMin, yMax]);

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

  const handleMouseMove = useCallback((state: any) => {
    if (state?.activePayload?.[0]) {
      setHoveredTime(state.activePayload[0].payload.elapsed_sec);
    }
  }, []);

  const handleMouseLeave = useCallback(() => {
    setHoveredTime(null);
  }, []);

  // Hovered block index (from chart hover - uses extended blocks for full coverage)
  const hoveredBlockIdx = hoveredTime != null
    ? extendedBlocks.findIndex((b) => hoveredTime >= b.startSec && hoveredTime < b.fillEnd)
    : -1;

  return (
    <div>
      {/* HR Chart */}
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart
          data={hrTimeline}
          margin={CHART_MARGIN}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onClick={() => setSelectedBlockIdx(null)}
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

          {/* Exercise fills — per extended block, covering full timeline with no gaps */}
          {extendedBlocks.map((block, i) => (
            <ReferenceArea
              key={`block-${i}`}
              x1={block.startSec}
              x2={block.fillEnd}
              fill={block.color}
              fillOpacity={
                selectedBlockIdx === i ? 0.50
                : selectedBlockIdx !== null ? 0.08
                : hoveredBlockIdx === i ? 0.35
                : 0.25
              }
              stroke="none"
            />
          ))}

          {/* Exercise boundary lines (white, solid — between different exercises) */}
          {extendedBlocks.slice(1).map((block, i) => (
            <ReferenceLine
              key={`exbound-${i}`}
              x={block.startSec}
              stroke="rgba(255,255,255,0.7)"
              strokeWidth={1.5}
            />
          ))}

          {/* Set boundary lines (white, dashed — between sets within an exercise) */}
          {extendedBlocks.flatMap((block, bi) =>
            block.sets.slice(0, -1).map((s, si) => (
              <ReferenceLine
                key={`setline-${bi}-${si}`}
                x={s.start_sec + s.duration_sec}
                stroke="rgba(255,255,255,0.4)"
                strokeDasharray="3 3"
                strokeWidth={0.75}
              />
            ))
          )}

          {/* Selected block highlight overlay */}
          {selectedBlockIdx !== null && extendedBlocks[selectedBlockIdx] && (
            <ReferenceArea
              x1={extendedBlocks[selectedBlockIdx].startSec}
              x2={extendedBlocks[selectedBlockIdx].fillEnd}
              fill="white"
              fillOpacity={0.12}
              stroke="rgba(255,255,255,0.8)"
              strokeWidth={2}
            />
          )}

          {/* Zone boundary lines (horizontal dashes) */}
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
            type="number"
            domain={[0, 'dataMax']}
            className="text-[10px]"
            tickLine={false}
            axisLine={false}
            tickFormatter={formatElapsed}
            tickCount={6}
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
            content={<UnifiedTooltip zones={zones} extendedBlocks={extendedBlocks} />}
          />
          <Area
            type="monotone"
            dataKey="hr"
            stroke="url(#hrZoneGradient)"
            strokeWidth={2}
            fill="url(#hrZoneGradientFill)"
            fillOpacity={0.15}
            dot={false}
            activeDot={{ r: 3, fill: "#fff", stroke: "rgba(255,255,255,0.5)" }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>

      {/* Exercise Labels (matching image style) */}
      {exerciseBlocks.length > 0 && totalDuration > 0 && (
        <div
          className="flex mt-2"
          style={{ marginLeft: BAR_LEFT, marginRight: CHART_MARGIN.right }}
        >
          {exerciseBlocks.map((block, i) => {
            const width = ((block.endSec - (i > 0 ? exerciseBlocks[i - 1].endSec : 0)) / totalDuration) * 100;
            const workingSets = block.sets.filter(s => s.set_type !== "REST" && s.set_type !== "WARMUP").length;
            const isSelected = selectedBlockIdx === i;
            const isHovered = hoveredBlockIdx === i;
            const dimmed = selectedBlockIdx !== null && !isSelected;

            return (
              <div
                key={i}
                className="flex flex-col items-center cursor-pointer transition-opacity duration-100 px-0.5"
                style={{
                  width: `${width}%`,
                  opacity: dimmed ? 0.35 : 1,
                }}
                onClick={() => setSelectedBlockIdx(isSelected ? null : i)}
              >
                <div
                  className="w-2 h-2 rounded-full mb-1 shrink-0"
                  style={{
                    backgroundColor: block.color,
                    boxShadow: isSelected || isHovered ? `0 0 6px ${block.color}` : "none",
                  }}
                />
                <span className="text-[10px] leading-tight text-center text-muted-foreground line-clamp-2">
                  {block.exercise}
                </span>
                <span className="text-[9px] text-muted-foreground/60">
                  {workingSets} sets
                </span>
                {blockAvgHrs.has(i) && (
                  <span className="text-[9px] text-red-400/70">
                    {blockAvgHrs.get(i)} bpm
                  </span>
                )}
              </div>
            );
          })}
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
