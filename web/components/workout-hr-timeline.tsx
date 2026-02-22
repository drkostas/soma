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

function formatCategory(cat: string | null): string {
  if (!cat) return "Unknown";
  if (cat !== cat.toUpperCase() && cat !== cat.toLowerCase()) return cat;
  return cat
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
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
  let isRest = false;

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
        exerciseName = formatCategory(s.exercise);
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

    if (!exerciseName) {
      const rest = exerciseSets.find(
        (s: ExerciseSet) =>
          s.set_type === "REST" &&
          elapsedSec >= s.start_sec &&
          elapsedSec <= s.start_sec + s.duration_sec
      );
      if (rest) isRest = true;
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
            Z{zoneInfo.zone}
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
      {isRest && <div className="text-muted-foreground mt-1">Rest</div>}

      <div className="text-muted-foreground mt-1">{formatElapsed(elapsedSec)}</div>
    </div>
  );
}

// --- Main Component ---

export function WorkoutHrTimeline({ hrTimeline, exerciseSets, hrZones }: WorkoutHrTimelineProps) {
  const [hoveredTime, setHoveredTime] = useState<number | null>(null);

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
  const yMin = Math.max(dataMinHr - 10, 40);
  const yMax = Math.min(dataMaxHr + 10, 220);

  const totalDuration =
    hrTimeline.length > 0 ? hrTimeline[hrTimeline.length - 1].elapsed_sec : 0;

  const visibleZones = zones.filter((z) => z.high >= yMin && z.low <= yMax);

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
          {/* Zone background bands */}
          {visibleZones.map((z) => {
            const config = ZONE_CONFIG[z.zone];
            if (!config) return null;
            return (
              <ReferenceArea
                key={`zone-${z.zone}`}
                y1={Math.max(z.low, yMin)}
                y2={Math.min(z.high, yMax)}
                fill={config.color}
                fillOpacity={0.06}
                ifOverflow="hidden"
                stroke="none"
              />
            );
          })}

          {/* Subtle exercise fills (vertical bands) */}
          {activeSets.map((s, i) => (
            <ReferenceArea
              key={`set-${i}`}
              x1={s.start_sec}
              x2={s.start_sec + s.duration_sec}
              fill={exerciseColorMap.get(s.exercise || "") || "#888"}
              fillOpacity={
                hoveredBlock && s.exercise === hoveredBlock.exercise ? 0.18 : 0.08
              }
              ifOverflow="hidden"
              stroke="none"
            />
          ))}

          {/* Zone boundary lines (subtle dashes) */}
          {visibleZones.slice(0, -1).map((z) => (
            <ReferenceLine
              key={`zline-${z.zone}`}
              y={z.high}
              stroke={ZONE_CONFIG[z.zone]?.color || "#888"}
              strokeDasharray="4 4"
              strokeOpacity={0.2}
            />
          ))}

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
            stroke="rgba(255,255,255,0.85)"
            strokeWidth={1.5}
            fill="rgba(255,255,255,0.04)"
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
            const isHovered = hoveredBlock === block;

            return (
              <div
                key={i}
                className="absolute top-0 bottom-0 rounded-sm overflow-hidden flex items-center transition-opacity duration-100"
                style={{
                  left: `${left}%`,
                  width: `${width}%`,
                  backgroundColor: block.color,
                  opacity: isHovered ? 0.95 : 0.55,
                }}
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
                  {formatCategory(block.exercise)}
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
