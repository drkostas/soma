"use client";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { ExternalLink } from "lucide-react";

interface ActivityMatch {
  dayId: number;
  dayDate: string;
  matched: boolean;
  completionScore: number | null;
  activity: {
    distance_km: string;
    duration_min: string;
    avg_pace_sec_km: number | null;
    avg_hr: number | null;
    max_hr: number | null;
    calories: number | null;
    garmin_id: number | null;
  } | null;
}

interface ActivitySidePanelProps {
  match: ActivityMatch | null;
  onClose: () => void;
  planDay?: {
    run_type: string;
    run_title: string;
    target_distance_km: number;
    workout_steps: any[];
  };
}

function formatPace(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${s.toString().padStart(2, "0")}/km`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function scoreColor(score: number): string {
  if (score >= 80) return "text-green-400";
  if (score >= 60) return "text-yellow-400";
  return "text-red-400";
}

function scoreBgColor(score: number): string {
  if (score >= 80) return "bg-green-500/10 ring-green-500/30";
  if (score >= 60) return "bg-yellow-500/10 ring-yellow-500/30";
  return "bg-red-500/10 ring-red-500/30";
}

function ProgressBar({
  label,
  value,
  max = 100,
}: {
  label: string;
  value: number;
  max?: number;
}) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span>{Math.round(value)}%</span>
      </div>
      <div className="h-1.5 bg-muted/50 rounded-full">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${pct}%`,
            backgroundColor:
              pct >= 80
                ? "oklch(62% 0.17 142)"
                : pct >= 60
                  ? "oklch(65% 0.17 90)"
                  : "oklch(62% 0.17 25)",
          }}
        />
      </div>
    </div>
  );
}

export function ActivitySidePanel({
  match,
  onClose,
  planDay,
}: ActivitySidePanelProps) {
  const isOpen = match !== null;

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="overflow-y-auto">
        {match && (
          <>
            <SheetHeader>
              <SheetTitle className="text-sm">
                {planDay?.run_title || match.dayDate}
              </SheetTitle>
              <SheetDescription className="text-xs">
                {formatDate(match.dayDate)}
                {planDay?.run_type && (
                  <span className="ml-2 capitalize text-muted-foreground/70">
                    {planDay.run_type}
                  </span>
                )}
              </SheetDescription>
            </SheetHeader>

            <div className="px-4 space-y-5">
              {/* Completion score */}
              {match.completionScore !== null && (
                <div className="flex flex-col items-center py-3">
                  <div
                    className={cn(
                      "w-16 h-16 rounded-full flex items-center justify-center ring-2",
                      scoreBgColor(match.completionScore),
                    )}
                  >
                    <span
                      className={cn(
                        "text-2xl font-bold tabular-nums",
                        scoreColor(match.completionScore),
                      )}
                    >
                      {match.completionScore}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground mt-1.5">
                    Completion Score
                  </span>
                </div>
              )}

              {/* Score breakdown */}
              {match.completionScore !== null && (
                <div className="space-y-2">
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Score Breakdown
                  </h4>
                  <ProgressBar
                    label="Pace compliance"
                    value={Math.min(100, (match.completionScore - 20) * 1.25)}
                  />
                  <ProgressBar
                    label="Distance compliance"
                    value={
                      planDay?.target_distance_km && match.activity
                        ? Math.max(
                            0,
                            100 *
                              (1 -
                                Math.abs(
                                  1 -
                                    parseFloat(match.activity.distance_km) /
                                      planDay.target_distance_km,
                                ) *
                                  3.33),
                          )
                        : 80
                    }
                  />
                  <ProgressBar label="HR compliance" value={100} />
                </div>
              )}

              {/* Activity stats */}
              {match.activity && (
                <div className="space-y-2">
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Activity Stats
                  </h4>
                  <div className="grid grid-cols-2 gap-2">
                    <StatBox
                      label="Distance"
                      value={`${match.activity.distance_km} km`}
                    />
                    <StatBox
                      label="Duration"
                      value={`${match.activity.duration_min} min`}
                    />
                    {match.activity.avg_pace_sec_km && (
                      <StatBox
                        label="Avg Pace"
                        value={formatPace(match.activity.avg_pace_sec_km)}
                      />
                    )}
                    {match.activity.avg_hr && (
                      <StatBox
                        label="Avg HR"
                        value={`${match.activity.avg_hr} bpm`}
                      />
                    )}
                    {match.activity.max_hr && (
                      <StatBox
                        label="Max HR"
                        value={`${match.activity.max_hr} bpm`}
                      />
                    )}
                    {match.activity.calories && (
                      <StatBox
                        label="Calories"
                        value={`${match.activity.calories} kcal`}
                      />
                    )}
                  </div>
                </div>
              )}

              {/* Plan vs actual comparison */}
              {match.activity && planDay && (
                <div className="space-y-2">
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Plan vs Actual
                  </h4>
                  <div className="rounded-lg border border-border/50 overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border/50 bg-muted/30">
                          <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">
                            Metric
                          </th>
                          <th className="px-3 py-1.5 text-right font-medium text-muted-foreground">
                            Plan
                          </th>
                          <th className="px-3 py-1.5 text-right font-medium text-muted-foreground">
                            Actual
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-b border-border/30">
                          <td className="px-3 py-1.5 text-muted-foreground">
                            Distance
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums">
                            {planDay.target_distance_km.toFixed(1)} km
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums">
                            {match.activity.distance_km} km
                          </td>
                        </tr>
                        {planDay.workout_steps?.[0]?.target_pace &&
                          match.activity.avg_pace_sec_km && (
                            <tr className="border-b border-border/30">
                              <td className="px-3 py-1.5 text-muted-foreground">
                                Pace
                              </td>
                              <td className="px-3 py-1.5 text-right tabular-nums">
                                {formatPace(
                                  planDay.workout_steps[0].target_pace,
                                )}
                              </td>
                              <td className="px-3 py-1.5 text-right tabular-nums">
                                {formatPace(match.activity.avg_pace_sec_km)}
                              </td>
                            </tr>
                          )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Links */}
              {match.activity?.garmin_id && (
                <div className="space-y-2">
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Links
                  </h4>
                  <a
                    href={`https://connect.garmin.com/modern/activity/${match.activity.garmin_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    <ExternalLink className="h-3 w-3" />
                    View in Garmin Connect
                  </a>
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/30 p-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-sm font-medium tabular-nums">{value}</div>
    </div>
  );
}
