"use client";

import { useState, useMemo } from "react";
import {
  ComposedChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
  BarChart,
  Bar,
  Cell,
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

interface WorkoutHrTimelineProps {
  hrTimeline: HrPoint[];
  exerciseSets?: ExerciseSet[];
}

// --- Constants ---

const EXERCISE_COLORS = [
  "#60a5fa", "#f97316", "#4ade80", "#f472b6", "#a78bfa",
  "#facc15", "#38bdf8", "#ef4444", "#34d399", "#fb923c",
];

// --- Utilities ---

function formatCategory(cat: string | null): string {
  if (!cat) return "Unknown";
  return cat
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return `${h}:${rm.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function getZoneColor(hr: number): string {
  if (hr < 120) return "#4ade80"; // Z1-2 green
  if (hr < 140) return "#facc15"; // Z3 yellow
  if (hr < 160) return "#f97316"; // Z4 orange
  return "#ef4444";               // Z5 red
}

// Build color mapping: exercise category -> color (based on first appearance order)
function buildExerciseColorMap(sets: ExerciseSet[]): Map<string, string> {
  const map = new Map<string, string>();
  let colorIdx = 0;
  for (const s of sets) {
    if (s.set_type === "ACTIVE" && s.exercise && !map.has(s.exercise)) {
      map.set(s.exercise, EXERCISE_COLORS[colorIdx % EXERCISE_COLORS.length]);
      colorIdx++;
    }
  }
  return map;
}

// --- Custom Tooltip for Timeline ---

function TimelineTooltip({ active, payload, exerciseSets, exerciseColorMap }: any) {
  if (!active || !payload?.[0]) return null;
  const point = payload[0].payload;
  const elapsedSec = point.elapsed_sec;
  const hr = point.hr;

  // Find which exercise set this point falls in
  let exerciseLabel = "";
  if (exerciseSets) {
    const activeSets = exerciseSets.filter((s: ExerciseSet) => s.set_type === "ACTIVE");
    let setCount: Record<string, number> = {};
    for (const s of activeSets) {
      const name = s.exercise || "Unknown";
      setCount[name] = (setCount[name] || 0) + 1;
      if (elapsedSec >= s.start_sec && elapsedSec <= s.start_sec + s.duration_sec) {
        exerciseLabel = `${formatCategory(s.exercise)} - Set ${setCount[name]}`;
        break;
      }
    }
  }

  return (
    <div className="bg-card text-card-foreground border border-border rounded-lg p-2 text-xs shadow-lg">
      {exerciseLabel && (
        <div className="font-medium mb-1">{exerciseLabel}</div>
      )}
      <div className="flex items-center gap-1.5">
        <span style={{ color: getZoneColor(hr) }} className="font-bold">{hr} bpm</span>
      </div>
      <div className="text-muted-foreground">{formatElapsed(elapsedSec)} elapsed</div>
    </div>
  );
}

// --- View A: HR Timeline ---

function HrTimelineChart({ hrTimeline, exerciseSets }: WorkoutHrTimelineProps) {
  const exerciseColorMap = useMemo(
    () => (exerciseSets ? buildExerciseColorMap(exerciseSets) : new Map()),
    [exerciseSets]
  );

  const activeSets = useMemo(
    () => (exerciseSets || []).filter((s) => s.set_type === "ACTIVE"),
    [exerciseSets]
  );

  const restSets = useMemo(
    () => (exerciseSets || []).filter((s) => s.set_type === "REST"),
    [exerciseSets]
  );

  // Compute HR range for Y axis
  const hrs = hrTimeline.map((p) => p.hr);
  const minHr = Math.max(Math.min(...hrs) - 10, 40);
  const maxHr = Math.min(Math.max(...hrs) + 10, 220);

  // Build gradient stops for zone-based area fill
  const gradientId = "hrZoneGradient";

  // Compute gradient stops from the data range
  const zoneStops = useMemo(() => {
    const range = maxHr - minHr;
    if (range <= 0) return [];
    // Zone boundaries as fraction of Y axis (inverted because SVG gradient goes top to bottom)
    const thresholds = [
      { hr: 160, color: "#ef4444" }, // Z5 red - top
      { hr: 140, color: "#f97316" }, // Z4 orange
      { hr: 120, color: "#facc15" }, // Z3 yellow
      { hr: 0,   color: "#4ade80" }, // Z1-2 green - bottom
    ];

    const stops: { offset: string; color: string }[] = [];
    for (const t of thresholds) {
      const offset = 1 - (t.hr - minHr) / range;
      const clampedOffset = Math.max(0, Math.min(1, offset));
      stops.push({ offset: `${(clampedOffset * 100).toFixed(1)}%`, color: t.color });
    }
    return stops;
  }, [minHr, maxHr]);

  return (
    <div>
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={hrTimeline} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              {zoneStops.map((s, i) => (
                <stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={0.35} />
              ))}
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />

          {/* Rest period bands (gray, behind everything) */}
          {restSets.map((s, i) => (
            <ReferenceArea
              key={`rest-${i}`}
              x1={s.start_sec}
              x2={s.start_sec + s.duration_sec}
              fill="#6b7280"
              fillOpacity={0.08}
              ifOverflow="hidden"
            />
          ))}

          {/* Exercise set bands (colored) */}
          {activeSets.map((s, i) => (
            <ReferenceArea
              key={`set-${i}`}
              x1={s.start_sec}
              x2={s.start_sec + s.duration_sec}
              fill={exerciseColorMap.get(s.exercise || "") || "#888"}
              fillOpacity={0.15}
              ifOverflow="hidden"
            />
          ))}

          <XAxis
            dataKey="elapsed_sec"
            className="text-[10px]"
            tickLine={false}
            tickFormatter={formatElapsed}
            interval="preserveStartEnd"
            minTickGap={40}
          />
          <YAxis
            className="text-[10px]"
            domain={[minHr, maxHr]}
            tickLine={false}
            tickFormatter={(v: number) => `${v}`}
          />
          <Tooltip
            content={
              <TimelineTooltip
                exerciseSets={exerciseSets}
                exerciseColorMap={exerciseColorMap}
              />
            }
          />
          <Area
            type="monotone"
            dataKey="hr"
            stroke="#f87171"
            strokeWidth={1.5}
            fill={`url(#${gradientId})`}
            dot={false}
            activeDot={{ r: 3, fill: "#f87171" }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>

      {/* Exercise Legend */}
      {exerciseColorMap.size > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 px-1">
          {Array.from(exerciseColorMap.entries()).map(([cat, color]) => (
            <div key={cat} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <div
                className="w-2.5 h-2.5 rounded-sm shrink-0"
                style={{ backgroundColor: color, opacity: 0.7 }}
              />
              <span>{formatCategory(cat)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- View B: HR per Set Bar Chart ---

interface SetBarData {
  label: string;
  exercise: string;
  avgHr: number;
  peakHr: number;
  reps: number;
  weight: number | null;
  color: string;
}

function HrPerSetChart({ hrTimeline, exerciseSets }: WorkoutHrTimelineProps) {
  const exerciseColorMap = useMemo(
    () => (exerciseSets ? buildExerciseColorMap(exerciseSets) : new Map()),
    [exerciseSets]
  );

  const barData: SetBarData[] = useMemo(() => {
    if (!exerciseSets) return [];
    const activeSets = exerciseSets.filter((s) => s.set_type === "ACTIVE");
    const setCountByExercise: Record<string, number> = {};

    return activeSets.map((s) => {
      const name = s.exercise || "Unknown";
      setCountByExercise[name] = (setCountByExercise[name] || 0) + 1;
      const setNum = setCountByExercise[name];

      // Find HR points within this set's time window
      const startSec = s.start_sec;
      const endSec = s.start_sec + s.duration_sec;
      const hrInSet = hrTimeline.filter(
        (p) => p.elapsed_sec >= startSec && p.elapsed_sec <= endSec
      );

      const avgHr =
        hrInSet.length > 0
          ? Math.round(hrInSet.reduce((sum, p) => sum + p.hr, 0) / hrInSet.length)
          : 0;
      const peakHr =
        hrInSet.length > 0 ? Math.max(...hrInSet.map((p) => p.hr)) : 0;

      return {
        label: `${formatCategory(name).split(" ").map(w => w[0]).join("")} ${setNum}`,
        exercise: formatCategory(name),
        avgHr,
        peakHr,
        reps: s.reps,
        weight: s.weight,
        color: exerciseColorMap.get(name) || "#888",
      };
    });
  }, [hrTimeline, exerciseSets, exerciseColorMap]);

  if (barData.length === 0) {
    return (
      <div className="flex items-center justify-center h-[200px] text-muted-foreground text-sm">
        No exercise set data available
      </div>
    );
  }

  return (
    <div>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={barData} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis
            dataKey="label"
            className="text-[10px]"
            tickLine={false}
            interval={0}
            angle={-45}
            textAnchor="end"
            height={50}
          />
          <YAxis
            className="text-[10px]"
            tickLine={false}
            domain={["dataMin - 10", "dataMax + 10"]}
            tickFormatter={(v: number) => `${v}`}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.[0]) return null;
              const d = payload[0].payload as SetBarData;
              return (
                <div className="bg-card text-card-foreground border border-border rounded-lg p-2 text-xs shadow-lg">
                  <div className="font-medium">{d.exercise}</div>
                  {d.weight && d.reps > 0 && <div className="mt-1">{d.weight} kg x {d.reps} reps</div>}
                  {!d.weight && d.reps > 0 && <div className="mt-1">{d.reps} reps</div>}
                  <div className={d.weight ? "" : "mt-1"}>Avg HR: {d.avgHr} bpm</div>
                  <div>Peak HR: {d.peakHr} bpm</div>
                </div>
              );
            }}
          />
          <Bar dataKey="avgHr" radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {barData.map((entry, idx) => (
              <Cell key={idx} fill={entry.color} fillOpacity={0.75} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Exercise Legend */}
      {exerciseColorMap.size > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 px-1">
          {Array.from(exerciseColorMap.entries()).map(([cat, color]) => (
            <div key={cat} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <div
                className="w-2.5 h-2.5 rounded-sm shrink-0"
                style={{ backgroundColor: color, opacity: 0.7 }}
              />
              <span>{formatCategory(cat)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Main Component ---

export function WorkoutHrTimeline({ hrTimeline, exerciseSets }: WorkoutHrTimelineProps) {
  const [view, setView] = useState<"timeline" | "per-set">("timeline");
  const hasSetData = exerciseSets && exerciseSets.length > 0;

  return (
    <div>
      {/* View toggle */}
      {hasSetData && (
        <div className="flex gap-1 mb-3">
          <button
            onClick={() => setView("timeline")}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              view === "timeline"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            HR Timeline
          </button>
          <button
            onClick={() => setView("per-set")}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              view === "per-set"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            HR per Set
          </button>
        </div>
      )}

      {view === "timeline" ? (
        <HrTimelineChart hrTimeline={hrTimeline} exerciseSets={exerciseSets} />
      ) : (
        <HrPerSetChart hrTimeline={hrTimeline} exerciseSets={exerciseSets} />
      )}
    </div>
  );
}
