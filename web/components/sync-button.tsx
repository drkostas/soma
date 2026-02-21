"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type SyncStatus = "never" | "running" | "success" | "error" | "completed";

interface SyncState {
  status: SyncStatus;
  lastSync: string | null;
  records: number;
  error: string | null;
}

const IDLE_POLL_MS = 60_000;
const FAST_POLL_MS = 3_000;
const FRESH_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

function relativeTime(iso: string | null): string {
  if (!iso) return "Never synced";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "Just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(diff / 3_600_000);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(diff / 86_400_000);
  return `${days}d ago`;
}

export function SyncButton() {
  const [state, setState] = useState<SyncState>({
    status: "never",
    lastSync: null,
    records: 0,
    error: null,
  });

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/sync/status");
      if (!res.ok) return;
      const data = await res.json();
      // API returns "completed" for finished syncs - normalize to "success"
      const status: SyncStatus =
        data.status === "completed" ? "success" : data.status;
      setState({
        status,
        lastSync: data.lastSync ?? null,
        records: data.recordsSynced ?? 0,
        error: data.error ?? null,
      });
    } catch {
      // Silently fail - keep existing state
    }
  }, []);

  // Start polling with the given interval, clearing any previous timer
  const startPolling = useCallback(
    (intervalMs: number) => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(fetchStatus, intervalMs);
    },
    [fetchStatus]
  );

  // Fetch on mount + idle polling
  useEffect(() => {
    fetchStatus();
    startPolling(IDLE_POLL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchStatus, startPolling]);

  // Switch to fast polling while running, back to idle when done
  useEffect(() => {
    if (state.status === "running") {
      startPolling(FAST_POLL_MS);
    } else {
      startPolling(IDLE_POLL_MS);
    }
  }, [state.status, startPolling]);

  const handleClick = async () => {
    if (state.status === "running") return;
    setState((prev) => ({ ...prev, status: "running" }));
    try {
      await fetch("/api/sync", { method: "POST" });
    } catch {
      // Fast polling will pick up the actual status
    }
  };

  const isRunning = state.status === "running";
  const isFresh =
    state.lastSync &&
    Date.now() - new Date(state.lastSync).getTime() < FRESH_THRESHOLD_MS;

  // Tooltip label
  let tooltipText: string;
  if (isRunning) {
    tooltipText = "Syncing...";
  } else if (state.status === "error" && state.error) {
    tooltipText = `Last sync failed: ${state.error}`;
  } else if (state.lastSync) {
    tooltipText = `Last synced: ${relativeTime(state.lastSync)}`;
  } else {
    tooltipText = "Never synced";
  }

  // Status dot color
  let dotClass: string | null = null;
  if (isRunning) {
    dotClass = "bg-primary animate-pulse";
  } else if (state.status === "error") {
    dotClass = "bg-red-400";
  } else if (state.status === "success" && isFresh) {
    dotClass = "bg-emerald-400";
  }

  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <button
          onClick={handleClick}
          disabled={isRunning}
          className={cn(
            "relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
            isRunning
              ? "text-primary cursor-not-allowed"
              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground cursor-pointer"
          )}
        >
          <RefreshCw
            className={cn("h-5 w-5", isRunning && "animate-spin")}
          />
          {dotClass && (
            <span
              className={cn(
                "absolute top-1 right-1 h-2 w-2 rounded-full",
                dotClass
              )}
            />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {tooltipText}
      </TooltipContent>
    </Tooltip>
  );
}
