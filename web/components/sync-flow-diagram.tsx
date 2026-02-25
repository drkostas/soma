"use client";

import { useState } from "react";
import { Watch, Dumbbell, Bike, Wind, Zap, ChevronRight, ChevronDown, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface PlatformNode {
  platform: string;
  isConnected: boolean;
  connectionType: "oauth" | "sync-service" | "planned";
  lastSync: string | null;
}

interface SyncRule {
  id: number;
  source_platform: string;
  activity_type: string;
  destinations: Record<string, unknown>;
  enabled: boolean;
}

interface SyncFlowDiagramProps {
  platforms: PlatformNode[];
  rules: SyncRule[];
}

const platformIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  garmin: Watch,
  hevy: Dumbbell,
  strava: Bike,
  telegram: Send,
  surfr: Wind,
};

const platformLabels: Record<string, string> = {
  garmin: "Garmin",
  hevy: "Hevy",
  strava: "Strava",
  telegram: "Telegram",
  surfr: "Surfr",
};

const connectionTypeLabels: Record<string, string> = {
  oauth: "OAuth",
  "sync-service": "Sync service",
  planned: "Planned",
};

// What each source provides (hardcoded — these are the data types each platform sends to Soma)
const sourceDataTypes: Record<string, string[]> = {
  garmin: ["Health", "Activities"],
  hevy: ["Workouts"],
};

const activityTypeLabels: Record<string, string> = {
  "*": "All",
  strength: "Strength",
  running: "Running",
  cycling: "Cycling",
  kite: "Kite",
};

function FlowNode({
  label,
  icon: Icon,
  isConnected,
  isHub,
  subtitle,
  dimmed,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  isConnected: boolean;
  isHub?: boolean;
  subtitle?: string;
  dimmed?: boolean;
}) {
  return (
    <div
      className={`relative flex items-center gap-2 rounded-xl border px-3 py-2 transition-opacity duration-200 ${
        isHub
          ? "border-primary/40 bg-primary/10 shadow-sm px-4 py-3"
          : isConnected
            ? "border-border bg-card"
            : "border-border/50 bg-muted/30"
      } ${dimmed ? "opacity-30" : ""} ${!isHub && !isConnected ? "opacity-50" : ""}`}
    >
      <div
        className={`flex items-center justify-center rounded-lg shrink-0 ${
          isHub ? "h-9 w-9 bg-primary text-primary-foreground" : "h-7 w-7 bg-accent"
        }`}
      >
        <Icon className={isHub ? "h-5 w-5" : "h-3.5 w-3.5"} />
      </div>
      <div className="min-w-0">
        <span
          className={`text-sm font-medium whitespace-nowrap block ${
            isHub ? "text-foreground" : "text-foreground/80"
          }`}
        >
          {label}
        </span>
        {subtitle && (
          <span className="text-[10px] text-muted-foreground whitespace-nowrap block">{subtitle}</span>
        )}
      </div>
      {!isHub && (
        <span
          className={`absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full border-2 border-background ${
            isConnected ? "bg-green-500" : "bg-muted-foreground/40"
          }`}
        />
      )}
    </div>
  );
}

function ArrowLine({
  isActive,
  badges,
  tooltipText,
  dimmed,
}: {
  isActive: boolean;
  badges?: { label: string; enabled: boolean }[];
  tooltipText: string;
  dimmed?: boolean;
}) {
  const lineColor = isActive ? "bg-primary/40" : "bg-muted-foreground/15";
  const arrowColor = isActive ? "text-primary/60" : "text-muted-foreground/20";

  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <div
          className={`flex flex-col items-center gap-1 px-1 transition-opacity duration-200 ${dimmed ? "opacity-30" : ""}`}
        >
          {/* Badges above the line */}
          {badges && badges.length > 0 && (
            <div className="flex flex-wrap justify-center gap-0.5">
              {badges.map((b) => (
                <span
                  key={b.label}
                  className={`text-[9px] px-1.5 py-0 rounded-full border ${
                    b.enabled
                      ? "border-primary/30 text-primary bg-primary/10"
                      : "border-border text-muted-foreground/50 line-through"
                  }`}
                >
                  {b.label}
                </span>
              ))}
            </div>
          )}
          {/* Arrow line */}
          <div className="flex items-center w-full min-w-[3rem]">
            <div className={`flex-1 h-px ${lineColor}`} />
            <ChevronRight className={`h-3.5 w-3.5 shrink-0 -ml-1 ${arrowColor}`} />
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={4}>
        <p className="text-xs">{tooltipText}</p>
      </TooltipContent>
    </Tooltip>
  );
}

export function SyncFlowDiagram({ platforms, rules }: SyncFlowDiagramProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const platformMap = Object.fromEntries(platforms.map((p) => [p.platform, p]));

  const sources = ["garmin", "hevy"];
  const destinations = ["strava", "garmin", "telegram"];

  // Build per-destination rule badges (deduplicated by activity type)
  function getRuleBadgesForDest(dest: string) {
    const matching = rules.filter((r) => {
      const dests = Object.keys(r.destinations);
      return dests.includes(dest);
    });
    if (matching.length === 0) return null;
    // Deduplicate by activity type — if any rule for that type is enabled, badge is enabled
    const byType = new Map<string, boolean>();
    for (const r of matching) {
      const label = activityTypeLabels[r.activity_type] || r.activity_type;
      byType.set(label, (byType.get(label) ?? false) || r.enabled);
    }
    return Array.from(byType.entries()).map(([label, enabled]) => ({ label, enabled }));
  }

  // Count active rules for a destination
  function activeRuleCount(dest: string) {
    return rules.filter((r) => r.enabled && Object.keys(r.destinations).includes(dest)).length;
  }

  function formatLastSync(lastSync: string | null) {
    if (!lastSync) return "Never";
    return new Date(lastSync).toLocaleDateString();
  }

  function isDimmed(platformKey: string) {
    if (!hovered) return false;
    return hovered !== platformKey && hovered !== "hub";
  }

  return (
    <div className="rounded-xl border border-border bg-card/50 px-6 py-5">
      {/* Desktop: grid layout */}
      <div className="hidden md:grid grid-cols-[auto_1fr_auto_1fr_auto] items-center gap-x-0 gap-y-3">
        {/* Phase labels row */}
        <div /> {/* empty: sources col */}
        <div className="text-center">
          <span className="text-[9px] uppercase tracking-widest text-muted-foreground/40 font-medium">Ingest</span>
        </div>
        <div /> {/* empty: hub col */}
        <div className="text-center">
          <span className="text-[9px] uppercase tracking-widest text-muted-foreground/40 font-medium">Sync</span>
        </div>
        <div /> {/* empty: dests col */}

        {/* Sources column — spans all 3 content rows, vertically centered */}
        <div className="row-span-3 flex flex-col justify-center gap-3 justify-self-end">
          <div
            onMouseEnter={() => setHovered("garmin-src")}
            onMouseLeave={() => setHovered(null)}
          >
            <Tooltip delayDuration={200}>
              <TooltipTrigger asChild>
                <div>
                  <FlowNode
                    label={platformLabels.garmin}
                    icon={platformIcons.garmin}
                    isConnected={!!platformMap.garmin?.isConnected}
                    subtitle="Health, Activities"
                    dimmed={isDimmed("garmin-src")}
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent side="left" sideOffset={4}>
                <p className="text-xs">
                  {connectionTypeLabels[platformMap.garmin?.connectionType ?? "planned"]}
                  {" · Last sync: "}
                  {formatLastSync(platformMap.garmin?.lastSync ?? null)}
                </p>
              </TooltipContent>
            </Tooltip>
          </div>
          <div
            onMouseEnter={() => setHovered("hevy-src")}
            onMouseLeave={() => setHovered(null)}
          >
            <Tooltip delayDuration={200}>
              <TooltipTrigger asChild>
                <div>
                  <FlowNode
                    label={platformLabels.hevy}
                    icon={platformIcons.hevy}
                    isConnected={!!platformMap.hevy?.isConnected}
                    subtitle="Workouts"
                    dimmed={isDimmed("hevy-src")}
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent side="left" sideOffset={4}>
                <p className="text-xs">
                  {connectionTypeLabels[platformMap.hevy?.connectionType ?? "planned"]}
                  {" · Last sync: "}
                  {formatLastSync(platformMap.hevy?.lastSync ?? null)}
                </p>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Ingest arrows column — spans all 3 content rows, vertically centered */}
        <div className="row-span-3 flex flex-col justify-center gap-3">
          <ArrowLine
            isActive={!!platformMap.garmin?.isConnected}
            badges={sourceDataTypes.garmin.map((d) => ({ label: d, enabled: true }))}
            tooltipText="Raw data ingestion (automatic when connected)"
            dimmed={isDimmed("garmin-src")}
          />
          <ArrowLine
            isActive={!!platformMap.hevy?.isConnected}
            badges={sourceDataTypes.hevy.map((d) => ({ label: d, enabled: true }))}
            tooltipText="Raw data ingestion (automatic when connected)"
            dimmed={isDimmed("hevy-src")}
          />
        </div>

        {/* Hub — spans all 3 content rows, centered */}
        <div
          className="row-span-3 justify-self-center self-center"
          onMouseEnter={() => setHovered("hub")}
          onMouseLeave={() => setHovered(null)}
        >
          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <div>
                <FlowNode label="Soma" icon={Zap} isConnected={true} isHub subtitle="Processing hub" />
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={4}>
              <p className="text-xs">Stores &amp; processes all health data</p>
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Row 1: Strava sync arrow + destination */}
        <ArrowLine
          isActive={!!platformMap.strava?.isConnected && activeRuleCount("strava") > 0}
          badges={getRuleBadgesForDest("strava") ?? [{ label: "No rules", enabled: false }]}
          tooltipText={
            activeRuleCount("strava") > 0
              ? `${activeRuleCount("strava")} active rule(s) syncing to Strava`
              : "No sync rules configured for Strava"
          }
          dimmed={isDimmed("strava-dest")}
        />

        <div
          className="justify-self-start"
          onMouseEnter={() => setHovered("strava-dest")}
          onMouseLeave={() => setHovered(null)}
        >
          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <div>
                <FlowNode
                  label={platformLabels.strava}
                  icon={platformIcons.strava}
                  isConnected={!!platformMap.strava?.isConnected}
                  subtitle={`${activeRuleCount("strava")} active rule${activeRuleCount("strava") === 1 ? "" : "s"}`}
                  dimmed={isDimmed("strava-dest")}
                />
              </div>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={4}>
              <p className="text-xs">
                {connectionTypeLabels[platformMap.strava?.connectionType ?? "planned"]}
                {" · "}
                {activeRuleCount("strava")} active rule(s)
              </p>
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Row 2: Garmin sync arrow + destination */}
        <ArrowLine
          isActive={!!platformMap.garmin?.isConnected && activeRuleCount("garmin") > 0}
          badges={getRuleBadgesForDest("garmin") ?? [{ label: "No rules", enabled: false }]}
          tooltipText={
            activeRuleCount("garmin") > 0
              ? `${activeRuleCount("garmin")} active rule(s) syncing to Garmin`
              : "No sync rules configured for Garmin"
          }
          dimmed={isDimmed("garmin-dest")}
        />

        <div
          className="justify-self-start"
          onMouseEnter={() => setHovered("garmin-dest")}
          onMouseLeave={() => setHovered(null)}
        >
          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <div>
                <FlowNode
                  label={platformLabels.garmin}
                  icon={platformIcons.garmin}
                  isConnected={!!platformMap.garmin?.isConnected}
                  subtitle={`${activeRuleCount("garmin")} active rule${activeRuleCount("garmin") === 1 ? "" : "s"}`}
                  dimmed={isDimmed("garmin-dest")}
                />
              </div>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={4}>
              <p className="text-xs">
                {connectionTypeLabels[platformMap.garmin?.connectionType ?? "planned"]}
                {" · "}
                {activeRuleCount("garmin")} active rule(s)
              </p>
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Row 3: Telegram sync arrow + destination */}
        <ArrowLine
          isActive={!!platformMap.telegram?.isConnected && activeRuleCount("telegram") > 0}
          badges={getRuleBadgesForDest("telegram") ?? [{ label: "No rules", enabled: false }]}
          tooltipText={
            activeRuleCount("telegram") > 0
              ? `${activeRuleCount("telegram")} active rule(s) sending to Telegram`
              : "No sync rules configured for Telegram"
          }
          dimmed={isDimmed("telegram-dest")}
        />

        <div
          className="justify-self-start"
          onMouseEnter={() => setHovered("telegram-dest")}
          onMouseLeave={() => setHovered(null)}
        >
          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <div>
                <FlowNode
                  label={platformLabels.telegram}
                  icon={platformIcons.telegram}
                  isConnected={!!platformMap.telegram?.isConnected}
                  subtitle={`${activeRuleCount("telegram")} active rule${activeRuleCount("telegram") === 1 ? "" : "s"}`}
                  dimmed={isDimmed("telegram-dest")}
                />
              </div>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={4}>
              <p className="text-xs">
                Workout card images
                {" · "}
                {activeRuleCount("telegram")} active rule(s)
              </p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Mobile: vertical stack */}
      <div className="md:hidden space-y-3">
        <p className="text-[9px] uppercase tracking-widest text-muted-foreground/40 font-medium text-center">
          Sources (Ingest)
        </p>
        <div className="flex flex-col items-center gap-2">
          {sources.map((src) => (
            <div key={src} className="flex items-center gap-2">
              <FlowNode
                label={platformLabels[src]}
                icon={platformIcons[src]}
                isConnected={!!platformMap[src]?.isConnected}
                subtitle={sourceDataTypes[src]?.join(", ")}
              />
            </div>
          ))}
        </div>

        <div className="flex flex-col items-center gap-0.5">
          <ChevronDown className="h-4 w-4 text-primary/40" />
          <span className="text-[9px] text-muted-foreground/40">ingest</span>
        </div>

        <div className="flex justify-center">
          <FlowNode label="Soma" icon={Zap} isConnected={true} isHub subtitle="Processing hub" />
        </div>

        <div className="flex flex-col items-center gap-0.5">
          <ChevronDown className="h-4 w-4 text-primary/40" />
          <span className="text-[9px] text-muted-foreground/40">sync</span>
        </div>

        <p className="text-[9px] uppercase tracking-widest text-muted-foreground/40 font-medium text-center">
          Destinations (Sync)
        </p>
        <div className="flex flex-col items-center gap-2">
          {destinations.map((dest) => {
            const badges = getRuleBadgesForDest(dest);
            return (
              <div key={`dest-${dest}`} className="flex items-center gap-2">
                <FlowNode
                  label={platformLabels[dest]}
                  icon={platformIcons[dest]}
                  isConnected={!!platformMap[dest]?.isConnected}
                  subtitle={
                    badges
                      ? badges.map((b) => b.label).join(", ")
                      : "No rules"
                  }
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
