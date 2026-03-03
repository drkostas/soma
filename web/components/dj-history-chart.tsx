// web/components/dj-history-chart.tsx
"use client";
import { useState } from "react";
import {
  ComposedChart, Line, ReferenceLine, XAxis, YAxis,
  Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";

interface HrPoint { ts: number; hr: number; target_bpm: number | null; }
interface SongEvent { ts: number; name: string; artist: string; track_bpm: number; target_bpm: number; reason: string; }

interface SongSegment extends SongEvent {
  tsEnd: number;
}

interface Props {
  hrHistory: HrPoint[];
  songEvents: SongEvent[];
}

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// Color based on BPM deviation from target (oklch, warm to cool)
function bpmDeviationColor(trackBpm: number, targetBpm: number): string {
  const dev = Math.abs(trackBpm - targetBpm);
  if (dev < 5)  return "oklch(0.55 0.14 142)"; // green — close to target
  if (dev < 15) return "oklch(0.58 0.16 83)";  // amber — slightly off
  if (dev < 30) return "oklch(0.57 0.18 45)";  // orange — moderately off
  return             "oklch(0.54 0.20 25)";     // red — far from target
}

function CustomTooltip({ active, payload, label, songEvents }: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: number;
  songEvents: SongEvent[];
}) {
  if (!active || !payload?.length || !label) return null;
  const song = [...songEvents].reverse().find(e => e.ts <= label);
  const hr = payload.find(p => p.name === "hr");
  const target = payload.find(p => p.name === "target_bpm");
  return (
    <div className="bg-popover border rounded shadow-lg px-3 py-2 text-xs space-y-1 max-w-[200px]">
      <div className="font-medium text-muted-foreground">{formatTime(label)}</div>
      {hr && <div>HR: <span className="font-medium text-foreground">{hr.value} bpm</span></div>}
      {target && target.value && <div>Target: <span className="font-medium">{target.value} BPM</span></div>}
      {song && (
        <div className="pt-1 border-t space-y-0.5">
          <div className="font-medium text-foreground truncate">{song.name}</div>
          <div className="text-muted-foreground truncate">{song.artist}</div>
          <div>{song.track_bpm} BPM
            {song.target_bpm && (
              <span className="text-muted-foreground/70"> (target {song.target_bpm})</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Inline tooltip shown on hover over a song strip segment
function SongTooltip({ seg }: { seg: SongSegment }) {
  const dev = seg.target_bpm ? seg.track_bpm - seg.target_bpm : null;
  const devLabel = dev !== null ? (dev > 0 ? `+${dev}` : `${dev}`) : null;
  return (
    <div
      className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 z-50 bg-popover border rounded shadow-lg px-3 py-2 text-xs space-y-0.5 w-max max-w-[220px] pointer-events-none"
    >
      <div className="font-medium text-foreground">{seg.name}</div>
      <div className="text-muted-foreground">{seg.artist}</div>
      <div>
        <span className="font-medium">{seg.track_bpm} BPM</span>
        {devLabel && (
          <span className="text-muted-foreground ml-1">({devLabel} from target {seg.target_bpm})</span>
        )}
      </div>
      <div className="text-muted-foreground/60">{formatTime(seg.ts)} – {formatTime(seg.tsEnd)}</div>
    </div>
  );
}

// Narrow text that fits in a song box based on available width
function boxLabel(name: string, pxWidth: number): string {
  const charsAvailable = Math.max(0, Math.floor(pxWidth / 6.5) - 1);
  if (charsAvailable <= 2) return "";
  return name.length > charsAvailable ? name.slice(0, charsAvailable - 1) + "…" : name;
}

export default function DjHistoryChart({ hrHistory, songEvents }: Props) {
  const [hoveredSeg, setHoveredSeg] = useState<SongSegment | null>(null);

  if (hrHistory.length < 2) {
    return (
      <div className="h-[180px] flex items-center justify-center text-xs text-muted-foreground/50">
        Chart appears after a few minutes of data…
      </div>
    );
  }

  const data = hrHistory.map(p => ({
    ts: p.ts,
    hr: p.hr,
    target_bpm: p.target_bpm ?? undefined,
  }));

  const allBpm = data.flatMap(d => [d.hr, d.target_bpm].filter((x): x is number => typeof x === "number" && x > 0));
  const yMin = allBpm.length > 0 ? Math.max(30, Math.min(...allBpm) - 10) : 60;
  const yMax = allBpm.length > 0 ? Math.min(220, Math.max(...allBpm) + 10) : 180;

  const timeMin = hrHistory[0].ts;
  const timeMax = hrHistory[hrHistory.length - 1].ts;
  const timeRange = timeMax - timeMin || 1;

  // Build song segments (each segment spans from its ts to the next segment's ts)
  const songSegments: SongSegment[] = songEvents.map((evt, i) => ({
    ...evt,
    tsEnd: songEvents[i + 1]?.ts ?? timeMax,
  }));

  // Chart layout constants (must match the Recharts chart below)
  // margin.left=-20, YAxis width=36 → data area starts at 16px from container left
  // margin.right=8 → data area ends 8px from container right
  const STRIP_PADDING_LEFT = 16;
  const STRIP_PADDING_RIGHT = 8;

  return (
    <div>
      {/* HR + target BPM chart */}
      <ResponsiveContainer width="100%" height={140}>
        <ComposedChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.5} />
          <XAxis
            dataKey="ts"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={formatTime}
            tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            tickCount={5}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            domain={[yMin, yMax]}
            tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            axisLine={false}
            tickLine={false}
            width={36}
          />
          <Tooltip
            content={<CustomTooltip songEvents={songEvents} />}
            cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1, strokeDasharray: "4 2" }}
          />
          <Line
            dataKey="hr"
            name="hr"
            stroke="var(--primary)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3 }}
            connectNulls
          />
          <Line
            dataKey="target_bpm"
            name="target_bpm"
            stroke="var(--muted-foreground)"
            strokeWidth={1.5}
            strokeDasharray="5 3"
            dot={false}
            activeDot={false}
            connectNulls
          />
          {/* Song transition markers — thin vertical lines */}
          {songEvents.map((evt) => (
            <ReferenceLine
              key={evt.ts}
              x={evt.ts}
              stroke="var(--muted-foreground)"
              strokeWidth={1}
              strokeOpacity={0.3}
              strokeDasharray="2 3"
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>

      {/* Song strip: color-coded boxes spanning each song's playing time */}
      {songSegments.length > 0 && (
        <div
          className="relative mt-1"
          style={{ paddingLeft: STRIP_PADDING_LEFT, paddingRight: STRIP_PADDING_RIGHT }}
        >
          <div className="relative h-12 rounded overflow-hidden">
            {songSegments.map((seg) => {
              const leftPct = Math.max(0, (seg.ts - timeMin) / timeRange) * 100;
              const widthPct = Math.min(
                (seg.tsEnd - Math.max(seg.ts, timeMin)) / timeRange * 100,
                100 - leftPct,
              );
              if (widthPct <= 0) return null;
              const bg = bpmDeviationColor(seg.track_bpm, seg.target_bpm);
              return (
                <div
                  key={seg.ts}
                  className="absolute top-0 h-full flex flex-col justify-center px-1.5 cursor-default select-none overflow-hidden border-r border-background/30"
                  style={{ left: `${leftPct}%`, width: `${widthPct}%`, background: bg }}
                  onMouseEnter={() => setHoveredSeg(seg)}
                  onMouseLeave={() => setHoveredSeg(null)}
                >
                  {/* BPM — always visible */}
                  <span className="text-white/90 font-bold leading-none" style={{ fontSize: 11 }}>
                    {seg.track_bpm}
                  </span>
                  {/* Song name — truncated to fit */}
                  <span className="text-white/70 leading-none mt-0.5 truncate" style={{ fontSize: 9 }}>
                    {seg.name}
                  </span>
                  {hoveredSeg?.ts === seg.ts && <SongTooltip seg={seg} />}
                </div>
              );
            })}
          </div>
          {/* Legend */}
          <div className="flex items-center gap-3 mt-1.5 text-[10px] text-muted-foreground/50">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm inline-block" style={{ background: bpmDeviationColor(0, 0) }} /> on target
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm inline-block" style={{ background: bpmDeviationColor(15, 0) }} /> ±15 BPM
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm inline-block" style={{ background: bpmDeviationColor(35, 0) }} /> ±30+ BPM
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
