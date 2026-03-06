"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";

interface Prefs {
  enabled: boolean;
  on_sync_workout: boolean;
  on_sync_run: boolean;
  on_sync_error: boolean;
  on_milestone: boolean;
  on_playlist_ready: boolean;
}

const defaultPrefs: Prefs = {
  enabled: true,
  on_sync_workout: true,
  on_sync_run: true,
  on_sync_error: true,
  on_milestone: true,
  on_playlist_ready: false,
};

const labels: Record<keyof Omit<Prefs, "enabled">, string> = {
  on_sync_workout: "Workout synced",
  on_sync_run: "Run synced",
  on_sync_error: "Sync errors",
  on_milestone: "Milestones & streaks",
  on_playlist_ready: "Playlist ready",
};

export function NotificationPreferences() {
  const [prefs, setPrefs] = useState<Prefs>(defaultPrefs);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/notifications/preferences")
      .then((r) => r.json())
      .then((d) => { setPrefs({ ...defaultPrefs, ...d }); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, []);

  const save = useCallback(async (updated: Prefs) => {
    setPrefs(updated);
    try {
      await fetch("/api/notifications/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
      toast.success("Preferences saved");
    } catch {
      toast.error("Failed to save preferences");
    }
  }, []);

  if (!loaded) return null;

  return (
    <div className="space-y-3 pt-3 border-t border-border">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Notify me about</p>
      {(Object.keys(labels) as (keyof typeof labels)[]).map((key) => (
        <label key={key} className="flex items-center justify-between text-sm cursor-pointer group">
          <span className="text-muted-foreground group-hover:text-foreground transition-colors">
            {labels[key]}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={prefs[key]}
            onClick={() => save({ ...prefs, [key]: !prefs[key] })}
            className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${
              prefs[key] ? "bg-primary" : "bg-muted"
            }`}
          >
            <span
              className={`pointer-events-none block h-4 w-4 rounded-full bg-background shadow-sm transition-transform ${
                prefs[key] ? "translate-x-4" : "translate-x-0"
              }`}
            />
          </button>
        </label>
      ))}
    </div>
  );
}
