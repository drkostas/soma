// web/components/live-dj-tab.tsx
"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  genres: string[];
  sources: string[];
}

type OffsetMode = "pump_up" | "normal" | "wind_down";
interface DjStatus {
  state: "stopped" | "starting" | "running" | "error";
  hr?: number;
  target_bpm?: number;
  current_track?: string;
  queued_track?: string;
  ms_remaining?: number;
  error?: string;
}

const OFFSET_VALUES: Record<OffsetMode, number> = {
  pump_up: 12,
  normal: 0,
  wind_down: -12,
};
const OFFSET_LABELS: Record<OffsetMode, string> = {
  pump_up: "⬆ Pump up",
  normal: "● Normal",
  wind_down: "⬇ Wind down",
};

function msToMinSec(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function LiveDjTab({ genres, sources }: Props) {
  const [hrRest, setHrRest] = useState(() => {
    if (typeof window === "undefined") return 60;
    return parseInt(localStorage.getItem("dj_hr_rest") ?? "60", 10) || 60;
  });
  const [hrMax, setHrMax] = useState(() => {
    if (typeof window === "undefined") return 190;
    return parseInt(localStorage.getItem("dj_hr_max") ?? "190", 10) || 190;
  });
  const [hrRestStr, setHrRestStr] = useState(() => String(typeof window !== "undefined" ? (parseInt(localStorage.getItem("dj_hr_rest") ?? "60", 10) || 60) : 60));
  const [hrMaxStr, setHrMaxStr] = useState(() => String(typeof window !== "undefined" ? (parseInt(localStorage.getItem("dj_hr_max") ?? "190", 10) || 190) : 190));
  const [offsetMode, setOffsetMode] = useState<OffsetMode>(() => {
    if (typeof window === "undefined") return "normal";
    const stored = localStorage.getItem("dj_offset_mode");
    const validModes: OffsetMode[] = ["pump_up", "normal", "wind_down"];
    return (validModes.includes(stored as OffsetMode) ? stored as OffsetMode : "normal");
  });
  const [status, setStatus] = useState<DjStatus>({ state: "stopped" });
  const pollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const isRunning = status.state === "running" || status.state === "starting";

  // Persist settings
  useEffect(() => { localStorage.setItem("dj_hr_rest", String(hrRest)); }, [hrRest]);
  useEffect(() => { localStorage.setItem("dj_hr_max", String(hrMax)); }, [hrMax]);
  useEffect(() => { localStorage.setItem("dj_offset_mode", offsetMode); }, [offsetMode]);

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
          offset: OFFSET_VALUES[offsetMode],
          genres,
          sources,
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
    <div className="p-4 space-y-4 max-w-lg">
      <div className="text-sm text-muted-foreground">
        Live DJ polls your Garmin HR and automatically queues the next song to match your effort.
      </div>

      {/* HR settings */}
      <div className="flex gap-4">
        <div className="space-y-1">
          <label htmlFor="dj-hr-rest" className="text-xs text-muted-foreground">Resting HR</label>
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
          <label htmlFor="dj-hr-max" className="text-xs text-muted-foreground">Max HR</label>
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

      {/* Offset toggle */}
      <div className="space-y-1">
        <div className="text-xs text-muted-foreground">Mode</div>
        <div className="flex gap-1">
          {(["pump_up", "normal", "wind_down"] as OffsetMode[]).map(mode => (
            <button
              key={mode}
              type="button"
              onClick={() => setOffsetMode(mode)}
              disabled={isRunning}
              className={cn(
                "flex-1 text-xs py-1.5 rounded border transition-colors disabled:opacity-50",
                offsetMode === mode
                  ? "bg-primary text-primary-foreground border-primary"
                  : "hover:bg-muted"
              )}
            >
              {OFFSET_LABELS[mode]}
            </button>
          ))}
        </div>
      </div>

      {/* Live status card */}
      {isRunning && (
        <div className="rounded-lg border bg-card p-3 space-y-1 text-sm">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-xs font-medium text-green-600">LIVE</span>
            {status.hr && (
              <span className="text-muted-foreground ml-auto">
                HR: <span className="text-foreground font-medium">{status.hr} bpm</span>
                {status.target_bpm && (
                  <> → Target: <span className="text-foreground font-medium">{status.target_bpm} BPM</span></>
                )}
              </span>
            )}
          </div>
          {status.current_track && (
            <div className="text-xs text-muted-foreground truncate">
              Now: <span className="text-foreground">{status.current_track}</span>
              {status.ms_remaining !== undefined && (
                <span className="ml-1 text-muted-foreground">({msToMinSec(status.ms_remaining)} left)</span>
              )}
            </div>
          )}
          {status.queued_track && (
            <div className="text-xs text-muted-foreground truncate">
              Queued: <span className="text-foreground">{status.queued_track}</span>
            </div>
          )}
          {status.state === "starting" && (
            <div className="text-xs text-muted-foreground italic">Starting up…</div>
          )}
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

      {/* Context note */}
      <div className="text-xs text-muted-foreground">
        Uses genre and source settings from the playlist builder.
        {sources.length > 0 && <> Sources: {sources.join(", ")}.</>}
        {genres.length > 0 && <> Genres: {genres.join(", ")}.</>}
      </div>
    </div>
  );
}
