// web/components/live-dj-tab.tsx
"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import PlaylistSourcePicker from "./playlist-source-picker";
import PlaylistGenrePicker from "./playlist-genre-picker";
import DjHistoryChart, { type PlayHistoryEntry } from "./dj-history-chart";

type OffsetMode = "pump_up" | "normal" | "wind_down";
interface QueueHistoryEntry {
  name: string;
  artist: string;
  target_bpm: number;
  track_bpm: number;
  reason: string;
  ts: number;
}
interface HrPoint {
  ts: number;
  hr: number;
  target_bpm: number | null;
}
interface DjStatus {
  state: "stopped" | "starting" | "running" | "error";
  hr?: number | null;
  hr_age_s?: number | null;
  target_bpm?: number | null;
  current_track?: string | null;
  queued_track?: string | null;
  ms_remaining?: number | null;
  no_queue_reason?: string | null;
  session_played_count?: number;
  allowed_track_count?: number | null;
  auto_detect?: boolean;
  context_name?: string | null;
  queue_history?: QueueHistoryEntry[];
  play_history?: PlayHistoryEntry[];
  hr_history?: HrPoint[];
  ts?: number;
  error?: string;
}

const DEFAULT_OFFSETS: Record<OffsetMode, number> = {
  pump_up: 12,
  normal: 0,
  wind_down: -12,
};
const OFFSET_ICONS: Record<OffsetMode, string> = {
  pump_up: "⬆",
  normal: "●",
  wind_down: "⬇",
};
const OFFSET_NAMES: Record<OffsetMode, string> = {
  pump_up: "Pump up",
  normal: "Normal",
  wind_down: "Wind down",
};

function formatReason(reason: string): string {
  if (reason === "initial") return "start";
  if (reason === "track_started") return "song started";
  if (reason === "45s_remaining") return "45s left";
  if (reason === "queued") return "queued";
  const m = reason.match(/^hr_shift_(\d+)_to_(\d+)$/);
  if (m) return `HR shift ${m[1]}→${m[2]} BPM`;
  return reason;
}

function msToMinSec(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${m}m ${s % 60}s`;
}

function loadArray(key: string, fallback: string[]): string[] {
  if (typeof window === "undefined") return fallback;
  const stored = localStorage.getItem(key) ?? "";
  return stored ? stored.split(",").map(s => s.trim()).filter(Boolean) : fallback;
}

export default function LiveDjTab() {
  const [hrRest, setHrRest] = useState(60);
  const [hrMax, setHrMax] = useState(190);
  const [hrRestStr, setHrRestStr] = useState("60");
  const [hrMaxStr, setHrMaxStr] = useState("190");
  const [hrFromGarmin, setHrFromGarmin] = useState(false);
  const [offsetMode, setOffsetMode] = useState<OffsetMode>(() => {
    if (typeof window === "undefined") return "normal";
    const stored = localStorage.getItem("dj_offset_mode");
    const validModes: OffsetMode[] = ["pump_up", "normal", "wind_down"];
    return (validModes.includes(stored as OffsetMode) ? stored as OffsetMode : "normal");
  });
  const [offsetValues, setOffsetValues] = useState<Record<OffsetMode, number>>(() => {
    if (typeof window === "undefined") return { ...DEFAULT_OFFSETS };
    try {
      const stored = localStorage.getItem("dj_offset_values");
      if (stored) return { ...DEFAULT_OFFSETS, ...JSON.parse(stored) } as Record<OffsetMode, number>;
    } catch {}
    return { ...DEFAULT_OFFSETS };
  });
  const [sourceMode, setSourceMode] = useState<"auto" | "manual">(() => {
    if (typeof window === "undefined") return "auto";
    return (localStorage.getItem("dj_source_mode") === "manual" ? "manual" : "auto");
  });
  const [sources, setSources] = useState<string[]>(() => loadArray("dj_sources", ["liked"]));
  const [genres, setGenres] = useState<string[]>(() => loadArray("dj_genres", []));
  const [genreThreshold, setGenreThreshold] = useState(() => {
    if (typeof window === "undefined") return 0.03;
    return parseFloat(localStorage.getItem("dj_genre_threshold") ?? "0.03") || 0.03;
  });
  const [status, setStatus] = useState<DjStatus>({ state: "stopped" });
  const [showHelp, setShowHelp] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const sessionStartRef = useRef<number | null>(null);
  const isRunning = status.state === "running" || status.state === "starting";

  // Tick every second so the "polled N ago" display stays current
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Track session start/stop for elapsed time display
  useEffect(() => {
    if (isRunning) {
      if (sessionStartRef.current === null) {
        sessionStartRef.current = Date.now();
      }
    } else {
      sessionStartRef.current = null;
    }
  }, [isRunning]);

  // Persist settings
  useEffect(() => { localStorage.setItem("dj_offset_mode", offsetMode); }, [offsetMode]);
  useEffect(() => { localStorage.setItem("dj_offset_values", JSON.stringify(offsetValues)); }, [offsetValues]);
  useEffect(() => { localStorage.setItem("dj_source_mode", sourceMode); }, [sourceMode]);
  useEffect(() => { localStorage.setItem("dj_sources", sources.join(",")); }, [sources]);
  useEffect(() => { localStorage.setItem("dj_genres", genres.join(",")); }, [genres]);
  useEffect(() => { localStorage.setItem("dj_genre_threshold", String(genreThreshold)); }, [genreThreshold]);

  // Auto-populate HR from Garmin on mount
  useEffect(() => {
    fetch("/api/playlist/dj/hr-defaults")
      .then(r => r.json())
      .then((data: { hr_rest?: number | null; hr_max?: number | null }) => {
        if (data.hr_rest) { setHrRest(data.hr_rest); setHrRestStr(String(data.hr_rest)); }
        if (data.hr_max) { setHrMax(data.hr_max); setHrMaxStr(String(data.hr_max)); }
        if (data.hr_rest || data.hr_max) setHrFromGarmin(true);
      })
      .catch(() => {});
  }, []);

  const pollStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/playlist/dj/status");
      if (!res.ok) return;
      const data = await res.json() as Partial<DjStatus>;
      if (!data.state) return;
      setStatus(data as DjStatus);
      if (data.state === "stopped") {
        clearInterval(pollRef.current);
      } else if (data.state === "error") {
        toast.error("Live DJ error", { description: data.error });
        // daemon retries automatically — keep polling
      }
    } catch {}
  }, []);

  async function handleStart() {
    try {
      const res = await fetch("/api/playlist/dj/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hr_rest: hrRest,
          hr_max: hrMax,
          offset: offsetValues[offsetMode],
          genres: sourceMode === "auto" ? [] : genres,
          sources: sourceMode === "auto" ? ["auto"] : sources,
        }),
      });
      if (!res.ok) throw new Error("Failed to start");
      setStatus({ state: "starting" });
      clearInterval(pollRef.current);
      pollRef.current = setInterval(pollStatus, 5000);
      void pollStatus();
    } catch {
      toast.error("Failed to start Live DJ");
    }
  }

  async function handleStop() {
    try {
      await fetch("/api/playlist/dj/stop", { method: "POST" });
      clearInterval(pollRef.current);
      setStatus({ state: "stopped" });
    } catch {
      toast.error("Failed to stop Live DJ — daemon may still be running");
    }
  }

  async function handleSkip() {
    if (!isRunning) return;
    try {
      const res = await fetch("/api/playlist/dj/skip", { method: "POST" });
      if (!res.ok) throw new Error("Failed to skip");
      toast.success("Skipped to next track");
      void pollStatus();
    } catch {
      toast.error("Failed to skip track");
    }
  }

  // Keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;

      switch (e.key) {
        case " ":
          e.preventDefault();
          if (isRunning) void handleStop();
          else void handleStart();
          break;
        case "n":
        case "N":
          if (isRunning) void handleSkip();
          break;
        case "ArrowRight":
          e.preventDefault();
          setOffsetValues(prev => ({
            ...prev,
            [offsetMode]: Math.min(prev[offsetMode] + 5, 30),
          }));
          break;
        case "ArrowLeft":
          e.preventDefault();
          setOffsetValues(prev => ({
            ...prev,
            [offsetMode]: Math.max(prev[offsetMode] - 5, -30),
          }));
          break;
        case "?":
          setShowHelp(h => !h);
          break;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  // Resume polling if already running (page reload)
  useEffect(() => {
    void pollStatus().then(() => {
      setStatus(prev => {
        if (prev.state === "running" || prev.state === "starting") {
          pollRef.current = setInterval(pollStatus, 5000);
        }
        return prev;
      });
    });
    return () => clearInterval(pollRef.current);
  }, [pollStatus]);

  return (
    <div className={cn(
      "p-4",
      !isRunning && "flex items-start justify-center pt-[8vh]"
    )}>
      <div className={cn(
        "flex gap-4",
        isRunning ? "items-start" : "flex-col w-full max-w-md"
      )}>
        {/* Settings panel */}
        <div className={cn("space-y-4 shrink-0", isRunning && "w-72")}>
          {!isRunning && (
            <h2 className="text-lg font-semibold tracking-tight">Live DJ</h2>
          )}
          <div className="text-sm text-muted-foreground">
            {isRunning
              ? "Live DJ is matching songs to your heart rate."
              : "Polls your Garmin HR in real time and automatically queues songs that match your effort."}
          </div>

          {/* HR settings */}
          <div className="flex gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                <label htmlFor="dj-hr-rest" className="text-xs text-muted-foreground">Resting HR</label>
                {hrFromGarmin && <span className="text-xs text-muted-foreground/60 italic">Garmin</span>}
              </div>
              <input
                id="dj-hr-rest"
                type="number"
                min={30}
                max={100}
                step={1}
                value={hrRestStr}
                onChange={e => setHrRestStr(e.target.value)}
                onBlur={e => {
                  const v = Math.max(30, Math.min(100, parseInt(e.target.value, 10) || 60));
                  setHrRest(v);
                  setHrRestStr(String(v));
                }}
                disabled={isRunning}
                className="w-20 h-8 text-sm border rounded px-2 bg-background disabled:opacity-50"
              />
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                <label htmlFor="dj-hr-max" className="text-xs text-muted-foreground">Max HR</label>
                {hrFromGarmin && <span className="text-xs text-muted-foreground/60 italic">Garmin</span>}
              </div>
              <input
                id="dj-hr-max"
                type="number"
                min={140}
                max={220}
                step={1}
                value={hrMaxStr}
                onChange={e => setHrMaxStr(e.target.value)}
                onBlur={e => {
                  const v = Math.max(140, Math.min(220, parseInt(e.target.value, 10) || 190));
                  setHrMax(v);
                  setHrMaxStr(String(v));
                }}
                disabled={isRunning}
                className="w-20 h-8 text-sm border rounded px-2 bg-background disabled:opacity-50"
              />
            </div>
          </div>

          {/* Offset toggle + per-mode BPM offset inputs */}
          <div className="space-y-1.5">
            <div className="text-xs text-muted-foreground">Mode</div>
            <div className="flex gap-1">
              {(["pump_up", "normal", "wind_down"] as OffsetMode[]).map(mode => {
                const val = offsetValues[mode];
                const sign = val > 0 ? "+" : "";
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setOffsetMode(mode)}
                    disabled={isRunning}
                    className={cn(
                      "flex-1 text-xs py-1.5 rounded border transition-colors disabled:opacity-50 flex flex-col items-center gap-0.5",
                      offsetMode === mode
                        ? "bg-primary text-primary-foreground border-primary"
                        : "hover:bg-muted"
                    )}
                  >
                    <span>{OFFSET_ICONS[mode]} {OFFSET_NAMES[mode]}</span>
                    <span className="opacity-70 text-[10px]">{sign}{val} BPM</span>
                  </button>
                );
              })}
            </div>
            {/* Offset editor for selected mode */}
            {!isRunning && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-24 shrink-0">
                  {OFFSET_NAMES[offsetMode]} offset
                </span>
                <input
                  type="range"
                  min={offsetMode === "wind_down" ? -30 : offsetMode === "pump_up" ? 0 : -15}
                  max={offsetMode === "wind_down" ? 0 : offsetMode === "pump_up" ? 30 : 15}
                  step={1}
                  value={offsetValues[offsetMode]}
                  disabled={isRunning}
                  onChange={e => setOffsetValues(prev => ({ ...prev, [offsetMode]: Number(e.target.value) }))}
                  className="flex-1 h-1 accent-primary disabled:opacity-50"
                />
                <span className="text-xs font-medium w-10 text-right">
                  {offsetValues[offsetMode] > 0 ? "+" : ""}{offsetValues[offsetMode]} BPM
                </span>
                <button
                  type="button"
                  onClick={() => setOffsetValues(prev => ({ ...prev, [offsetMode]: DEFAULT_OFFSETS[offsetMode] }))}
                  className="text-xs text-muted-foreground/60 hover:text-muted-foreground"
                  title="Reset to default"
                >
                  ↺
                </button>
              </div>
            )}
          </div>

          {/* Source mode */}
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Source</div>
            <div className="flex gap-1">
              {(["auto", "manual"] as const).map(mode => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setSourceMode(mode)}
                  disabled={isRunning}
                  className={cn(
                    "flex-1 text-xs py-1.5 rounded border transition-colors disabled:opacity-50",
                    sourceMode === mode
                      ? "bg-primary text-primary-foreground border-primary"
                      : "hover:bg-muted"
                  )}
                >
                  {mode === "auto" ? "⟳ Auto (from Spotify)" : "▤ Manual"}
                </button>
              ))}
            </div>
            {sourceMode === "auto" && !isRunning && (
              <p className="text-xs text-muted-foreground/60">
                Play any playlist or album on Spotify — DJ will match songs from it.
              </p>
            )}
          </div>

          {/* Manual: Sources + Genres pickers */}
          {sourceMode === "manual" && (
            <div className="flex gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isRunning}
                    className="flex-1 h-8 text-xs justify-between gap-1 disabled:opacity-50"
                  >
                    <span>
                      Sources{" "}
                      <span className="text-muted-foreground">({sources.length})</span>
                    </span>
                    <ChevronDown className="w-3 h-3 shrink-0" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-3">
                  <PlaylistSourcePicker selected={sources} onChange={setSources} />
                </PopoverContent>
              </Popover>

              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isRunning}
                    className="flex-1 h-8 text-xs justify-between gap-1 disabled:opacity-50"
                  >
                    <span>
                      Genres{" "}
                      <span className="text-muted-foreground">
                        {genres.length > 0 ? `(${genres.length})` : "(any)"}
                      </span>
                    </span>
                    <ChevronDown className="w-3 h-3 shrink-0" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-3">
                  <PlaylistGenrePicker
                    selected={genres}
                    onChange={setGenres}
                    threshold={genreThreshold}
                    onThresholdChange={setGenreThreshold}
                  />
                </PopoverContent>
              </Popover>
            </div>
          )}

          {/* Start / Stop */}
          {isRunning ? (
            <Button variant="destructive" className="w-full" onClick={handleStop}>
              ■ Stop Live DJ
            </Button>
          ) : (
            <Button className="w-full" onClick={handleStart}>
              ▶ Start Live DJ
            </Button>
          )}

          {/* Shortcuts hint */}
          <div className="text-[10px] text-muted-foreground/40 select-none text-center">
            Space: play/pause · N: next · ←→: offset · ?: help
          </div>
        </div>

        {/* LIVE card */}
        {status.state !== "stopped" && (
          <div className="flex-1 min-w-0 rounded-lg border bg-card p-3 space-y-3 text-sm">
            {/* Header row */}
            <div className="flex items-center gap-2">
              {status.state === "error" ? (
                <span className="w-2 h-2 rounded-full bg-red-500" />
              ) : status.state === "starting" ? (
                <span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
              ) : (
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              )}
              <span className={cn(
                "text-xs font-medium",
                status.state === "error" ? "text-red-600" :
                status.state === "starting" ? "text-yellow-600" :
                "text-green-600"
              )}>
                {status.state === "error" ? "ERROR" :
                 status.state === "starting" ? "STARTING…" :
                 "LIVE"}
              </span>
              <span className="ml-auto flex items-center gap-2">
                {sessionStartRef.current !== null && (
                  <span className="text-xs text-muted-foreground">
                    Session: {formatElapsed(Date.now() - sessionStartRef.current)}
                  </span>
                )}
                {status.ts && (() => {
                  const elapsedS = Math.floor(Date.now() / 1000 - status.ts);
                  const label = elapsedS < 60
                    ? `${elapsedS}s ago`
                    : `${Math.floor(elapsedS / 60)}m ago`;
                  return (
                    <span className="text-xs text-muted-foreground/60">
                      polled {label}
                    </span>
                  );
                })()}
              </span>
            </div>

            {/* Session stats summary */}
            {status.play_history && status.play_history.length > 0 && (() => {
              const played = status.play_history.filter(e => e.status !== "queued");
              if (played.length === 0) return null;
              const matchPcts = played
                .filter(e => e.track_bpm && e.target_bpm)
                .map(e => Math.round(100 - (Math.abs(e.track_bpm! - e.target_bpm!) / e.target_bpm!) * 100));
              const avgMatch = matchPcts.length > 0
                ? Math.round(matchPcts.reduce((a, b) => a + b, 0) / matchPcts.length)
                : null;
              const hrs = (status.hr_history ?? []).map(p => p.hr).filter(h => h > 0);
              const hrMin = hrs.length > 0 ? Math.min(...hrs) : null;
              const hrMax = hrs.length > 0 ? Math.max(...hrs) : null;
              return (
                <div className="text-xs text-muted-foreground">
                  {played.length} song{played.length !== 1 ? "s" : ""}
                  {avgMatch !== null && <> · avg match: {avgMatch}%</>}
                  {hrMin !== null && hrMax !== null && <> · HR range: {hrMin}–{hrMax}</>}
                </div>
              );
            })()}

            {/* Error message */}
            {status.state === "error" && status.error && (
              <div className="text-xs text-red-600 bg-red-50 dark:bg-red-950/30 rounded px-2 py-1">
                {status.error}
              </div>
            )}

            {/* HR + Target BPM */}
            <div className="flex items-center gap-3 text-xs">
              {status.hr ? (
                <span className={cn(
                  "text-muted-foreground",
                  (status.hr_age_s ?? 0) > 3600 && "text-amber-600 dark:text-amber-400"
                )}>
                  HR <span className="font-medium">{status.hr} bpm</span>
                  {status.hr_age_s != null && (
                    <span className="opacity-70 ml-1">
                      ({status.hr_age_s < 120
                        ? "just now"
                        : status.hr_age_s < 3600
                          ? `${Math.round(status.hr_age_s / 60)}m ago`
                          : `${Math.round(status.hr_age_s / 3600)}h ago — stale`})
                    </span>
                  )}
                </span>
              ) : (
                <span className="text-muted-foreground/60 italic">Waiting for Garmin HR…</span>
              )}
              {status.target_bpm && (
                <span className="text-muted-foreground">
                  → target <span className="text-foreground font-medium">{status.target_bpm} BPM</span>
                </span>
              )}
            </div>

            {/* No-queue reason */}
            {status.no_queue_reason && (
              <div className="text-xs text-amber-600 dark:text-amber-400">
                {status.no_queue_reason === "no_hr"
                  ? "⚠ No HR data — will queue once Garmin syncs"
                  : status.no_queue_reason === "no_candidates"
                    ? `⚠ No tracks match ${status.target_bpm ?? "?"} BPM — widen genres or sources`
                    : status.no_queue_reason === "already_queued"
                      ? null
                      : `⚠ ${status.no_queue_reason}`}
              </div>
            )}

            {/* Current track */}
            {status.current_track ? (
              <div className="text-xs text-muted-foreground truncate">
                ▶ <span className="text-foreground">{status.current_track}</span>
                {status.ms_remaining != null && (
                  <span className="ml-1 text-muted-foreground/60">({msToMinSec(status.ms_remaining)} left)</span>
                )}
              </div>
            ) : status.state === "running" && (
              <div className="text-xs text-muted-foreground/60 italic">Nothing playing on Spotify</div>
            )}

            {/* Queued track */}
            {status.queued_track && (
              <div className="text-xs text-muted-foreground truncate">
                ⏭ <span className="text-foreground">{status.queued_track}</span>
                <span className="text-muted-foreground/60 ml-1">(queued)</span>
              </div>
            )}

            {/* Source pool / auto-detect context */}
            {status.auto_detect ? (
              <div className="text-xs text-muted-foreground/60">
                {status.context_name
                  ? <>Auto: sourcing from <span className="text-foreground">{status.context_name}</span>{status.allowed_track_count != null ? ` (${status.allowed_track_count} tracks)` : ""}</>
                  : "Auto-detect: play something on Spotify to set source"}
              </div>
            ) : status.allowed_track_count != null && (
              <div className="text-xs text-muted-foreground/50">
                Pool: {status.allowed_track_count} tracks from selected source
              </div>
            )}

            {/* HR / BPM history chart */}
            {(status.hr_history && status.hr_history.length > 0) || (status.play_history && status.play_history.length > 0) ? (
              <div className="pt-2 border-t">
                <div className="text-xs text-muted-foreground/60 font-medium mb-1">Session timeline</div>
                <DjHistoryChart
                  hrHistory={status.hr_history ?? []}
                  playHistory={status.play_history ?? []}
                />
              </div>
            ) : null}

            {/* Queue history */}
            {status.queue_history && status.queue_history.length > 0 && (
              <div className="pt-1 border-t space-y-1">
                <div className="text-xs text-muted-foreground/60 font-medium">Queued this session</div>
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {[...status.queue_history].reverse().map((entry, i) => (
                    <div key={i} className="text-xs flex items-baseline gap-1.5">
                      <span className="text-foreground/80 truncate flex-1">{entry.name}</span>
                      <span className="shrink-0 text-muted-foreground/50">{entry.artist}</span>
                      <span
                        className="shrink-0 text-muted-foreground font-medium"
                        title={`Target: ${entry.target_bpm} BPM · Track: ${entry.track_bpm} BPM · Trigger: ${formatReason(entry.reason)}`}
                      >
                        {entry.track_bpm} BPM
                      </span>
                      <span className="shrink-0 text-muted-foreground/40 text-[10px]">
                        {formatReason(entry.reason)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Shortcuts help overlay */}
      {showHelp && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          onClick={() => setShowHelp(false)}
        >
          <div className="absolute inset-0 bg-black/60" />
          <div
            className="relative rounded-lg border bg-card p-5 shadow-lg max-w-xs w-full"
            onClick={e => e.stopPropagation()}
          >
            <div className="text-sm font-medium mb-3">Keyboard shortcuts</div>
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
              <kbd className="px-1.5 py-0.5 rounded border bg-muted text-center font-mono text-[11px]">Space</kbd>
              <span className="text-muted-foreground">Toggle play / pause</span>
              <kbd className="px-1.5 py-0.5 rounded border bg-muted text-center font-mono text-[11px]">N</kbd>
              <span className="text-muted-foreground">Skip to next song</span>
              <kbd className="px-1.5 py-0.5 rounded border bg-muted text-center font-mono text-[11px]">←</kbd>
              <span className="text-muted-foreground">Decrease BPM offset by 5</span>
              <kbd className="px-1.5 py-0.5 rounded border bg-muted text-center font-mono text-[11px]">→</kbd>
              <span className="text-muted-foreground">Increase BPM offset by 5</span>
              <kbd className="px-1.5 py-0.5 rounded border bg-muted text-center font-mono text-[11px]">?</kbd>
              <span className="text-muted-foreground">Toggle this help</span>
            </div>
            <button
              type="button"
              onClick={() => setShowHelp(false)}
              className="mt-4 w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Press ? or click anywhere to close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
