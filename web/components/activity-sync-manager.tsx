"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Footprints,
  Dumbbell,
  Bike,
  Mountain,
  Waves,
  Zap,
  CheckCircle2,
  XCircle,
  Minus,
  Loader2,
  ExternalLink,
} from "lucide-react";

export interface ActivitySource {
  platform: "garmin" | "hevy";
  source_id: string;
  manufacturer: string | null;
}

export interface MergedActivity {
  name: string;
  activity_type: string;
  start_time: string;
  duration: number | null;
  distance: number | null;
  sources: ActivitySource[];
  sync_status: "sent" | "error" | "external" | null;
  destination_id: string | null;
  synced_at: string | null;
  synced_from: "garmin" | "hevy" | null;
}

interface ActivitySyncManagerProps {
  activities: MergedActivity[];
  stravaConnected: boolean;
}

const activityTypeIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  running: Footprints,
  trail_running: Footprints,
  treadmill_running: Footprints,
  strength_training: Dumbbell,
  strength: Dumbbell,
  cycling: Bike,
  mountain_biking: Bike,
  indoor_cycling: Bike,
  swimming: Waves,
  lap_swimming: Waves,
  open_water_swimming: Waves,
  hiking: Mountain,
};

const activityTypeLabels: Record<string, string> = {
  running: "Running",
  trail_running: "Trail Run",
  treadmill_running: "Treadmill",
  strength_training: "Strength",
  strength: "Strength",
  cycling: "Cycling",
  mountain_biking: "MTB",
  indoor_cycling: "Indoor Ride",
  swimming: "Swimming",
  lap_swimming: "Swimming",
  open_water_swimming: "Open Water",
  hiking: "Hiking",
  walking: "Walking",
  yoga: "Yoga",
};

// Tab filter categories
const TAB_FILTERS: Record<string, string[]> = {
  all: [],
  running: ["running", "trail_running", "treadmill_running"],
  strength: ["strength_training", "strength"],
  cycling: ["cycling", "mountain_biking", "indoor_cycling"],
};

// Default source per activity type
const STRENGTH_TYPES = new Set(["strength_training", "strength"]);

function getDefaultSource(activity: MergedActivity): "garmin" | "hevy" {
  if (activity.sources.length === 1) return activity.sources[0].platform;
  // Prefer Hevy for strength, Garmin for everything else
  return STRENGTH_TYPES.has(activity.activity_type) ? "hevy" : "garmin";
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return "\u2014";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatDistance(meters: number | null): string {
  if (!meters || meters <= 0) return "";
  const km = meters / 1000;
  if (km >= 1) return `${km.toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr.includes("T") ? dateStr : dateStr.replace(" ", "T") + "Z");
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "2-digit" }),
  });
}

function SyncStatusBadge({
  status,
  destinationId,
  syncedFrom,
}: {
  status: "sent" | "error" | "external" | null;
  destinationId: string | null;
  syncedFrom: string | null;
}) {
  const stravaUrl = destinationId
    ? `https://www.strava.com/activities/${destinationId}`
    : null;

  if (status === "sent" || status === "external") {
    const badge = (
      <Badge variant="default" className="bg-green-600 text-xs gap-1 cursor-pointer">
        <CheckCircle2 className="h-3 w-3" />
        On Strava
      </Badge>
    );
    return stravaUrl ? (
      <a href={stravaUrl} target="_blank" rel="noopener noreferrer">{badge}</a>
    ) : badge;
  }
  if (status === "error") {
    return (
      <Badge variant="destructive" className="text-xs gap-1">
        <XCircle className="h-3 w-3" />
        Error
      </Badge>
    );
  }
  return (
    <span className="text-muted-foreground/40">
      <Minus className="h-4 w-4" />
    </span>
  );
}

function ActivityRow({
  activity,
  stravaConnected,
  onSync,
  syncing,
}: {
  activity: MergedActivity;
  stravaConnected: boolean;
  onSync: (platform: "garmin" | "hevy", sourceId: string, force?: boolean) => void;
  syncing: boolean;
}) {
  const Icon = activityTypeIcons[activity.activity_type] || Zap;
  const typeLabel = activityTypeLabels[activity.activity_type] || activity.activity_type;
  const dist = formatDistance(activity.distance);

  const canSync = stravaConnected && !activity.sync_status && !syncing;
  const activeSource = getDefaultSource(activity);
  const activeSourceObj = activity.sources.find((s) => s.platform === activeSource) || activity.sources[0];

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-border/50 last:border-0">
      {/* Icon */}
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent shrink-0">
        <Icon className="h-4 w-4 text-accent-foreground" />
      </div>

      {/* Activity info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{activity.name}</span>
          {activity.sources.map((s) => (
            <Badge key={s.platform} variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
              {s.platform === "garmin" ? "Garmin" : "Hevy"}
            </Badge>
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
          <span>{typeLabel}</span>
          <span>&middot;</span>
          <span>{formatDate(activity.start_time)}</span>
          <span>&middot;</span>
          <span>{formatDuration(activity.duration)}</span>
          {dist && (
            <>
              <span>&middot;</span>
              <span>{dist}</span>
            </>
          )}
        </div>
      </div>

      {/* Sync status */}
      <div className="flex items-center gap-2 shrink-0">
        <SyncStatusBadge
          status={activity.sync_status}
          destinationId={activity.destination_id}
          syncedFrom={activity.synced_from}
        />
        {canSync && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => onSync(activeSourceObj.platform, activeSourceObj.source_id)}
          >
            <ExternalLink className="h-3 w-3" />
            Strava
          </Button>
        )}
        {syncing && (
          <Button variant="outline" size="sm" className="h-7 text-xs" disabled>
            <Loader2 className="h-3 w-3 animate-spin" />
          </Button>
        )}
      </div>
    </div>
  );
}

export function ActivitySyncManager({
  activities,
  stravaConnected,
}: ActivitySyncManagerProps) {
  const [syncingKeys, setSyncingKeys] = useState<Set<string>>(new Set());
  const [localStatuses, setLocalStatuses] = useState<
    Record<string, "pending" | "sent" | "error">
  >({});

  function activityKey(a: MergedActivity): string {
    return a.sources.map((s) => `${s.platform}:${s.source_id}`).sort().join("|");
  }

  async function handleSync(platform: "garmin" | "hevy", sourceId: string, force?: boolean) {
    const key = `${platform}:${sourceId}`;
    setSyncingKeys((prev) => new Set(prev).add(key));

    try {
      const resp = await fetch("/api/sync/activity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_platform: platform,
          source_id: sourceId,
          destination: "strava",
          ...(force ? { force: true } : {}),
        }),
      });

      if (resp.ok) {
        setLocalStatuses((prev) => ({ ...prev, [key]: "pending" }));
        setTimeout(() => {
          setLocalStatuses((prev) => ({ ...prev, [key]: "sent" }));
          setSyncingKeys((prev) => {
            const next = new Set(prev);
            next.delete(key);
            return next;
          });
        }, 3000);
      } else {
        if (resp.status === 409) {
          setLocalStatuses((prev) => ({ ...prev, [key]: "sent" }));
        } else {
          setLocalStatuses((prev) => ({ ...prev, [key]: "error" }));
        }
        setSyncingKeys((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    } catch {
      setLocalStatuses((prev) => ({ ...prev, [key]: "error" }));
      setSyncingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  function getEffectiveStatus(a: MergedActivity): MergedActivity["sync_status"] {
    // Check if any source has a local status update
    for (const src of a.sources) {
      const local = localStatuses[`${src.platform}:${src.source_id}`];
      if (local === "sent") return "sent";
      if (local === "error") return "error";
    }
    return a.sync_status;
  }

  function isSyncing(a: MergedActivity): boolean {
    return a.sources.some((s) => syncingKeys.has(`${s.platform}:${s.source_id}`));
  }

  function filterActivities(tab: string): MergedActivity[] {
    const types = TAB_FILTERS[tab];
    if (!types || types.length === 0) return activities;
    return activities.filter((a) => types.includes(a.activity_type));
  }

  const counts = {
    all: activities.length,
    running: filterActivities("running").length,
    strength: filterActivities("strength").length,
    cycling: filterActivities("cycling").length,
  };

  const syncedCount = activities.filter((a) => {
    const eff = getEffectiveStatus(a);
    return eff === "sent" || eff === "external";
  }).length;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Activity Sync Manager</CardTitle>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{syncedCount}/{activities.length} synced to Strava</span>
            {!stravaConnected && (
              <Badge variant="outline" className="text-xs text-yellow-600">
                Strava not connected
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="all">
          <TabsList variant="line" className="w-full justify-start">
            <TabsTrigger value="all" className="gap-1.5 text-xs">
              All
              <span className="text-muted-foreground">{counts.all}</span>
            </TabsTrigger>
            <TabsTrigger value="running" className="gap-1.5 text-xs">
              <Footprints className="h-3.5 w-3.5" />
              Running
              <span className="text-muted-foreground">{counts.running}</span>
            </TabsTrigger>
            <TabsTrigger value="strength" className="gap-1.5 text-xs">
              <Dumbbell className="h-3.5 w-3.5" />
              Strength
              <span className="text-muted-foreground">{counts.strength}</span>
            </TabsTrigger>
            <TabsTrigger value="cycling" className="gap-1.5 text-xs">
              <Bike className="h-3.5 w-3.5" />
              Cycling
              <span className="text-muted-foreground">{counts.cycling}</span>
            </TabsTrigger>
          </TabsList>

          {["all", "running", "strength", "cycling"].map((tab) => (
            <TabsContent key={tab} value={tab} className="mt-3">
              {filterActivities(tab).length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  No {tab === "all" ? "" : tab + " "}activities in the last 30 days.
                </p>
              ) : (
                <div className="max-h-[400px] overflow-y-auto">
                  {filterActivities(tab).map((activity) => {
                    const key = activityKey(activity);
                    const effectiveStatus = getEffectiveStatus(activity);
                    const effectiveActivity = { ...activity, sync_status: effectiveStatus };
                    return (
                      <ActivityRow
                        key={key}
                        activity={effectiveActivity}
                        stravaConnected={stravaConnected}
                        onSync={handleSync}
                        syncing={isSyncing(activity)}
                      />
                    );
                  })}
                </div>
              )}
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  );
}
