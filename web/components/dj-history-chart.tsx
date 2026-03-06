// web/components/dj-history-chart.tsx
"use client";
import { useEffect, useRef, useState } from "react";

export interface PlayHistoryEntry {
  track_id: string;
  name: string;
  artist: string;
  track_bpm: number | null;
  target_bpm: number | null;
  started_at: number;    // Unix timestamp (actual for played/current, estimated for queued)
  duration_ms: number | null;
  image_url: string | null;
  status: "played" | "current" | "queued";
}

interface HrPoint { ts: number; hr: number; target_bpm: number | null; }

interface Props {
  hrHistory: HrPoint[];
  playHistory: PlayHistoryEntry[];
}

// Layout constants
const PX_PER_SEC = 1.8;         // pixels per second of timeline
const HR_HEIGHT = 100;           // px for HR chart area
const STRIP_HEIGHT = 52;         // px for song boxes
const YAXIS_W = 32;              // px for Y-axis label column
const TIMELINE_HEIGHT = HR_HEIGHT + STRIP_HEIGHT + 8; // total

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// Color by BPM deviation from target
function bpmColor(trackBpm: number | null, targetBpm: number | null, alpha = 1): string {
  if (!trackBpm || !targetBpm) return `rgba(100,100,100,${alpha})`;
  const dev = Math.abs(trackBpm - targetBpm);
  const [l, c, h] =
    dev < 5  ? [0.55, 0.14, 142] :
    dev < 15 ? [0.58, 0.16, 83]  :
    dev < 30 ? [0.57, 0.18, 45]  :
               [0.54, 0.20, 25];
  return alpha < 1
    ? `color-mix(in oklch, oklch(${l} ${c} ${h}) ${Math.round(alpha * 100)}%, transparent)`
    : `oklch(${l} ${c} ${h})`;
}

interface TooltipState {
  entry: PlayHistoryEntry;
  x: number;   // client X
  y: number;   // client Y
}

export default function DjHistoryChart({ hrHistory, playHistory }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [nowX, setNowX] = useState(0);

  // --- Time domain (computed before hooks so hooks are always called) ---
  const nowTs = Date.now() / 1000;

  const allTs: number[] = [
    ...hrHistory.map(p => p.ts),
    ...playHistory.map(e => e.started_at),
    ...playHistory
      .filter(e => e.duration_ms)
      .map(e => e.started_at + (e.duration_ms! / 1000)),
    nowTs + 120,
  ];

  const hasData = allTs.length > 1 && hrHistory.length >= 2;

  const timeMin = hasData ? Math.min(...allTs) : nowTs - 300;
  const timeMax = hasData ? Math.max(...allTs) : nowTs + 120;
  const timeRange = Math.max(timeMax - timeMin, 60);
  const totalWidth = Math.max(timeRange * PX_PER_SEC, 200);

  function timeToX(ts: number): number {
    return (ts - timeMin) * PX_PER_SEC;
  }

  // --- HR Y scale ---
  const allBpm = hrHistory.flatMap(p =>
    [p.hr, p.target_bpm].filter((v): v is number => typeof v === "number" && v > 0)
  );
  const yMin = allBpm.length > 0 ? Math.max(30, Math.min(...allBpm) - 10) : 60;
  const yMax = allBpm.length > 0 ? Math.min(220, Math.max(...allBpm) + 10) : 180;

  function hrToY(bpm: number): number {
    const pct = 1 - (bpm - yMin) / (yMax - yMin);
    return Math.max(0, Math.min(HR_HEIGHT - 2, pct * (HR_HEIGHT - 2) + 1));
  }

  const hrPoints = hrHistory
    .map(p => `${timeToX(p.ts).toFixed(1)},${hrToY(p.hr).toFixed(1)}`)
    .join(" ");

  const targetPoints = hrHistory
    .filter(p => p.target_bpm)
    .map(p => `${timeToX(p.ts).toFixed(1)},${hrToY(p.target_bpm!).toFixed(1)}`)
    .join(" ");

  const tickCount = 4;
  const yTicks: number[] = Array.from({ length: tickCount + 1 }, (_, i) =>
    Math.round(yMin + (i / tickCount) * (yMax - yMin))
  );

  const xTickCount = Math.min(6, Math.floor(totalWidth / 80));
  const xTicks: number[] = Array.from({ length: xTickCount + 1 }, (_, i) =>
    timeMin + (i / xTickCount) * timeRange
  );

  // ALL hooks must be before any early return
  // Auto-scroll to bring "now" into view on mount + when data changes
  useEffect(() => {
    const x = timeToX(nowTs);
    setNowX(x);
    if (containerRef.current) {
      const el = containerRef.current;
      const target = x - el.clientWidth * 0.65;
      el.scrollLeft = Math.max(0, target);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playHistory.length, hrHistory.length]);

  // Live "now" line ticks every second
  useEffect(() => {
    const id = setInterval(() => setNowX(timeToX(Date.now() / 1000)), 5000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeMin]);

  // Early return AFTER all hooks
  if (!hasData) {
    return (
      <div className="h-[160px] flex items-center justify-center text-xs text-muted-foreground/50">
        Chart appears after a few minutes of data…
      </div>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      {/* Y-axis + scrollable content side by side */}
      <div style={{ display: "flex" }}>

        {/* Fixed Y-axis labels */}
        <div
          style={{
            width: YAXIS_W,
            height: TIMELINE_HEIGHT,
            flexShrink: 0,
            position: "relative",
          }}
        >
          {/* Y-axis label */}
          <div
            style={{
              position: "absolute",
              top: HR_HEIGHT / 2,
              left: -2,
              transform: "rotate(-90deg) translateX(-50%)",
              transformOrigin: "0 0",
              fontSize: 8,
              fontWeight: 600,
              letterSpacing: "0.04em",
              color: "var(--muted-foreground)",
              opacity: 0.55,
              whiteSpace: "nowrap",
              userSelect: "none",
            }}
          >
            HR (BPM)
          </div>
          {yTicks.map(bpm => (
            <div
              key={bpm}
              style={{
                position: "absolute",
                right: 4,
                top: hrToY(bpm) - 6,
                fontSize: 9,
                lineHeight: 1,
                color: "var(--muted-foreground)",
                opacity: 0.7,
                userSelect: "none",
              }}
            >
              {bpm}
            </div>
          ))}
        </div>

        {/* Scrollable timeline */}
        <div
          ref={containerRef}
          style={{
            overflowX: "auto",
            overflowY: "hidden",
            flex: 1,
            height: TIMELINE_HEIGHT,
          }}
        >
          <div style={{ width: totalWidth, height: TIMELINE_HEIGHT, position: "relative" }}>

            {/* HR chart SVG */}
            <svg
              style={{ position: "absolute", top: 0, left: 0 }}
              width={totalWidth}
              height={HR_HEIGHT}
            >
              {/* HR zone background bands */}
              {([
                [100, 120, "oklch(65% 0.18 220)"],
                [120, 140, "oklch(62% 0.17 142)"],
                [140, 155, "oklch(80% 0.18 87)"],
                [155, 170, "oklch(72% 0.19 50)"],
                [170, 190, "oklch(60% 0.22 25)"],
              ] as const).map(([lo, hi, color]) => {
                const cLo = Math.max(lo, yMin);
                const cHi = Math.min(hi, yMax);
                if (cLo >= cHi) return null;
                const rY = hrToY(cHi);
                const rH = hrToY(cLo) - rY;
                return (
                  <rect
                    key={`zone-${lo}`}
                    x={0}
                    width={totalWidth}
                    y={rY}
                    height={rH}
                    fill={color}
                    opacity={0.06}
                  />
                );
              })}

              {/* Grid lines */}
              {yTicks.map(bpm => (
                <line
                  key={bpm}
                  x1={0}
                  x2={totalWidth}
                  y1={hrToY(bpm)}
                  y2={hrToY(bpm)}
                  stroke="var(--border)"
                  strokeOpacity={0.4}
                  strokeDasharray="3 3"
                />
              ))}

              {/* Target BPM dashed line */}
              {targetPoints && (
                <polyline
                  points={targetPoints}
                  fill="none"
                  stroke="var(--muted-foreground)"
                  strokeWidth={1.5}
                  strokeDasharray="5 3"
                  strokeOpacity={0.6}
                />
              )}

              {/* HR line */}
              {hrPoints && (
                <polyline
                  points={hrPoints}
                  fill="none"
                  stroke="var(--primary)"
                  strokeWidth={2}
                  strokeLinejoin="round"
                />
              )}

              {/* Song transition vertical markers */}
              {playHistory.filter(e => e.status !== "queued").map(e => (
                <line
                  key={e.track_id + e.started_at}
                  x1={timeToX(e.started_at)}
                  x2={timeToX(e.started_at)}
                  y1={0}
                  y2={HR_HEIGHT}
                  stroke="var(--muted-foreground)"
                  strokeWidth={1}
                  strokeOpacity={0.25}
                  strokeDasharray="2 3"
                />
              ))}
            </svg>

            {/* X-axis time labels */}
            <div style={{ position: "absolute", top: HR_HEIGHT, left: 0, width: totalWidth, height: 14 }}>
              {xTicks.map(ts => (
                <div
                  key={ts}
                  style={{
                    position: "absolute",
                    left: timeToX(ts),
                    transform: "translateX(-50%)",
                    fontSize: 9,
                    color: "var(--muted-foreground)",
                    opacity: 0.6,
                    whiteSpace: "nowrap",
                    userSelect: "none",
                  }}
                >
                  {formatTime(ts)}
                </div>
              ))}
            </div>

            {/* Song strip */}
            <div
              style={{
                position: "absolute",
                top: HR_HEIGHT + 14,
                left: 0,
                width: totalWidth,
                height: STRIP_HEIGHT - 14,
                overflow: "visible",
              }}
            >
              {playHistory.map((entry, i) => {
                // Cap end time at next song's start (handles skips — actual play shorter than duration)
                const nextEntry = playHistory[i + 1];
                const maxEnd = nextEntry && nextEntry.status !== "queued"
                  ? nextEntry.started_at
                  : Infinity;
                const durationEnd = entry.duration_ms
                  ? entry.started_at + entry.duration_ms / 1000
                  : entry.started_at + 240; // 4 min fallback
                const songEnd = Math.min(durationEnd, maxEnd);
                const x = timeToX(entry.started_at);
                const w = Math.max(2, timeToX(songEnd) - x);
                const isQueued = entry.status === "queued";
                const bg = bpmColor(entry.track_bpm, entry.target_bpm);

                return (
                  <div
                    key={entry.track_id + entry.started_at}
                    style={{
                      position: "absolute",
                      left: x,
                      width: w,
                      top: 0,
                      height: STRIP_HEIGHT - 14,
                      background: bg,
                      opacity: isQueued ? 0.45 : 1,
                      borderRadius: 3,
                      borderRight: "1px solid rgba(0,0,0,0.25)",
                      overflow: "hidden",
                      cursor: isQueued ? "default" : "pointer",
                      display: "flex",
                      alignItems: "stretch",
                      boxSizing: "border-box",
                    }}
                    onClick={() => {
                      if (!isQueued) {
                        window.open(`https://open.spotify.com/track/${entry.track_id}`, "_blank");
                      }
                    }}
                    onMouseEnter={(e) =>
                      setTooltip({ entry, x: e.clientX, y: e.clientY })
                    }
                    onMouseMove={(e) =>
                      setTooltip(t => t ? { ...t, x: e.clientX, y: e.clientY } : null)
                    }
                    onMouseLeave={() => setTooltip(null)}
                  >
                    {/* Album art thumbnail */}
                    {entry.image_url && w > 50 && (
                      <img
                        src={entry.image_url}
                        alt=""
                        style={{
                          width: STRIP_HEIGHT - 14,
                          height: STRIP_HEIGHT - 14,
                          objectFit: "cover",
                          flexShrink: 0,
                          opacity: 0.85,
                        }}
                      />
                    )}
                    {/* Text content */}
                    {w > 30 && (
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "center",
                          padding: "2px 5px",
                          overflow: "hidden",
                          flex: 1,
                        }}
                      >
                        {entry.track_bpm && (
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              color: "rgba(255,255,255,0.95)",
                              lineHeight: 1.1,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {entry.track_bpm} bpm
                          </span>
                        )}
                        {w > 60 && (
                          <span
                            style={{
                              fontSize: 9,
                              color: "rgba(255,255,255,0.75)",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              lineHeight: 1.2,
                            }}
                          >
                            {entry.name}
                          </span>
                        )}
                        {w > 100 && entry.artist && (
                          <span
                            style={{
                              fontSize: 8,
                              color: "rgba(255,255,255,0.55)",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              lineHeight: 1.2,
                            }}
                          >
                            {entry.artist}
                          </span>
                        )}
                      </div>
                    )}
                    {/* "Next" badge for queued */}
                    {isQueued && w > 40 && (
                      <div
                        style={{
                          position: "absolute",
                          top: 3,
                          right: 4,
                          fontSize: 8,
                          color: "rgba(255,255,255,0.8)",
                          background: "rgba(0,0,0,0.3)",
                          borderRadius: 2,
                          padding: "1px 3px",
                          lineHeight: 1.3,
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                        }}
                      >
                        next
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* "Now" vertical line */}
            <div
              style={{
                position: "absolute",
                left: nowX,
                top: 0,
                width: 1.5,
                height: TIMELINE_HEIGHT,
                background: "var(--primary)",
                opacity: 0.6,
                pointerEvents: "none",
              }}
            />
          </div>
        </div>
      </div>

      {/* BPM deviation legend */}
      <div
        style={{
          display: "flex",
          gap: 12,
          marginTop: 6,
          paddingLeft: YAXIS_W,
          fontSize: 10,
          color: "var(--muted-foreground)",
          opacity: 0.55,
        }}
      >
        {([["on target", 0, 0], ["±15 bpm", 15, 0], ["±30+ bpm", 35, 0]] as const).map(
          ([label, dev]) => (
            <span key={label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 2,
                  background: bpmColor(dev, 0),
                  display: "inline-block",
                }}
              />
              {label}
            </span>
          )
        )}
        <span style={{ marginLeft: "auto", opacity: 0.7 }}>— target BPM</span>
      </div>

      {/* Hover tooltip (fixed, portal-like) */}
      {tooltip && (
        <SongTooltip entry={tooltip.entry} clientX={tooltip.x} clientY={tooltip.y} />
      )}
    </div>
  );
}

function SongTooltip({
  entry,
  clientX,
  clientY,
}: {
  entry: PlayHistoryEntry;
  clientX: number;
  clientY: number;
}) {
  const dev =
    entry.track_bpm && entry.target_bpm
      ? entry.track_bpm - entry.target_bpm
      : null;

  return (
    <div
      style={{
        position: "fixed",
        left: clientX + 12,
        top: clientY - 10,
        zIndex: 50,
        background: "var(--popover)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
        padding: 0,
        overflow: "hidden",
        pointerEvents: "none",
        maxWidth: 240,
        minWidth: 180,
      }}
    >
      {/* Album art header */}
      {entry.image_url && (
        <img
          src={entry.image_url}
          alt=""
          style={{ width: "100%", height: 120, objectFit: "cover", display: "block" }}
        />
      )}
      <div style={{ padding: "10px 12px", fontSize: 12 }}>
        <div
          style={{
            fontWeight: 700,
            color: "var(--foreground)",
            marginBottom: 2,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {entry.name}
        </div>
        <div
          style={{
            color: "var(--muted-foreground)",
            fontSize: 11,
            marginBottom: 8,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {entry.artist}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11 }}>
          {entry.track_bpm && (
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--muted-foreground)" }}>Song BPM</span>
              <span style={{ fontWeight: 600, color: "var(--foreground)" }}>
                {entry.track_bpm}
              </span>
            </div>
          )}
          {entry.target_bpm && (
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--muted-foreground)" }}>Target</span>
              <span style={{ fontWeight: 600, color: "var(--foreground)" }}>
                {entry.target_bpm}
                {dev !== null && (
                  <span
                    style={{
                      marginLeft: 4,
                      fontSize: 10,
                      opacity: 0.7,
                      color: Math.abs(dev) < 5 ? "oklch(0.55 0.14 142)" : Math.abs(dev) < 15 ? "oklch(0.58 0.16 83)" : "oklch(0.57 0.18 45)",
                    }}
                  >
                    {dev > 0 ? `+${dev}` : dev} off
                  </span>
                )}
              </span>
            </div>
          )}
          {entry.duration_ms && (
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--muted-foreground)" }}>Duration</span>
              <span style={{ color: "var(--foreground)" }}>{formatDuration(entry.duration_ms)}</span>
            </div>
          )}
          <div
            style={{
              marginTop: 4,
              paddingTop: 4,
              borderTop: "1px solid var(--border)",
              color: "var(--muted-foreground)",
              fontSize: 10,
              opacity: 0.75,
            }}
          >
            {entry.status === "queued"
              ? `Queued — est. ${formatTime(entry.started_at)}`
              : `Started ${formatTime(entry.started_at)}`}
          </div>
        </div>
      </div>
    </div>
  );
}
