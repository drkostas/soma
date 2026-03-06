"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface HRZone {
  zone: number;
  seconds: number;
  low: number;
  high: number;
}

const ZONE_COLORS = [
  "bg-gray-400",    // Zone 1 - Warm Up
  "bg-blue-400",    // Zone 2 - Easy
  "bg-green-400",   // Zone 3 - Aerobic
  "bg-orange-400",  // Zone 4 - Threshold
  "bg-red-400",     // Zone 5 - Maximum
];

const ZONE_NAMES = ["Warm Up", "Easy", "Aerobic", "Threshold", "Maximum"];

function formatTime(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function HRZoneChart({ zones }: { zones: HRZone[] }) {
  if (!zones || zones.length === 0) {
    return (
      <div className="flex items-center justify-center h-[160px] text-muted-foreground text-sm">
        No HR zone data
      </div>
    );
  }

  const totalSeconds = zones.reduce((sum, z) => sum + z.seconds, 0);

  return (
    <TooltipProvider>
      <div className="space-y-2">
        {zones.map((z, i) => {
          const pct = totalSeconds > 0 ? (z.seconds / totalSeconds) * 100 : 0;
          const zoneName = ZONE_NAMES[i] || "";
          return (
            <Tooltip key={z.zone}>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-2 text-xs cursor-default">
                  <span className="w-24 text-muted-foreground">
                    Z{z.zone} {zoneName}
                  </span>
                  <div className="flex-1 h-5 bg-muted rounded-sm overflow-hidden">
                    <div
                      className={`h-full rounded-sm ${ZONE_COLORS[i] || "bg-gray-400"}`}
                      style={{ width: `${Math.max(pct, 1)}%` }}
                    />
                  </div>
                  <span className="w-12 text-right font-medium">
                    {formatTime(z.seconds)}
                  </span>
                  <span className="w-10 text-right text-muted-foreground">
                    {pct.toFixed(0)}%
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                <p className="font-semibold">Z{z.zone} {zoneName}</p>
                <p className="text-muted-foreground">{z.low}–{z.high} bpm</p>
                <p>{formatTime(z.seconds)} &middot; {pct.toFixed(0)}%</p>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
