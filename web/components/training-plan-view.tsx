"use client";

import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, Dumbbell } from "lucide-react";
import { cn } from "@/lib/utils";
import { WorkoutCompletionButton } from "@/components/workout-completion-button";
import { GarminPushButton } from "@/components/garmin-push-button";
import { RaceDayProtocol } from "@/components/race-day-protocol";
import { PaceWaterfall } from "@/components/pace-waterfall";
import { WorkoutStepEditor } from "@/components/workout-step-editor";
import { ActivitySidePanel } from "@/components/activity-side-panel";
import { normalizeSteps } from "@/lib/normalize-steps";
import type { NormalizedStep } from "@/lib/normalize-steps";
import type { DeltaWorkout } from "@/lib/training-engine";
import type { ProjectedDay } from "@/lib/forward-simulation";

interface TrainingDay {
  id: number;
  day_date: string;
  week_number: number;
  day_of_week: number;
  run_type: string;
  run_title: string;
  run_description: string;
  target_distance_km: number;
  workout_steps: any;
  gym_workout: string | null;
  gym_notes: string | null;
  load_level: string;
  actual_distance_km: number | null;
  completed: boolean;
  garmin_push_status: string;
  plan_name: string;
  race_date: string;
  goal_time_seconds: number;
}

export interface ActivityMatch {
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

interface TrainingPlanViewProps {
  days: TrainingDay[];
  today: string;
  activityMatches?: ActivityMatch[];
  deltaWorkouts?: DeltaWorkout[];
  onDayClick?: (dayId: number) => void;
  /** Called when workout steps are edited inline. Map of dayId -> modified steps. */
  onStepsEdited?: (modifiedSteps: Map<number, NormalizedStep[]>) => void;
  /** Forward simulation projected days for adaptation visualization. */
  projectedDays?: ProjectedDay[] | null;
  /** Whether the intensity slider is actively shifted from 1.0. */
  sliderActive?: boolean;
}

const weekTitles: Record<number, string> = {
  1: "Foundation",
  2: "Specificity",
  3: "Peak",
  4: "Taper",
  5: "Race Week",
};

const runTypeColors: Record<string, { bg: string; text: string }> = {
  rest: { bg: "bg-zinc-500/10", text: "text-zinc-400" },
  easy: { bg: "bg-green-500/10", text: "text-green-400" },
  recovery: { bg: "bg-green-500/10", text: "text-green-400" },
  tempo: { bg: "bg-orange-500/10", text: "text-orange-400" },
  intervals: { bg: "bg-orange-500/10", text: "text-orange-400" },
  threshold: { bg: "bg-orange-500/10", text: "text-orange-400" },
  long: { bg: "bg-blue-500/10", text: "text-blue-400" },
  race: { bg: "bg-purple-500/10", text: "text-purple-400" },
};

const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function formatPace(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}


export function TrainingPlanView({
  days,
  today,
  activityMatches,
  deltaWorkouts,
  onDayClick,
  onStepsEdited,
  projectedDays,
  sliderActive,
}: TrainingPlanViewProps) {
  const [sidePanelMatch, setSidePanelMatch] = useState<ActivityMatch | null>(null);
  const [sidePanelDay, setSidePanelDay] = useState<TrainingDay | null>(null);

  // Local state for edited workout steps (dayId -> modified steps)
  const [modifiedSteps, setModifiedSteps] = useState<Map<number, NormalizedStep[]>>(new Map());

  const handleStepChange = useCallback(
    (dayId: number, newSteps: NormalizedStep[]) => {
      setModifiedSteps((prev) => {
        const next = new Map(prev);
        next.set(dayId, newSteps);
        onStepsEdited?.(next);
        return next;
      });
    },
    [onStepsEdited],
  );

  // Build lookup maps
  const matchByDayId = new Map<number, ActivityMatch>();
  if (activityMatches) {
    for (const m of activityMatches) matchByDayId.set(m.dayId, m);
  }
  const deltaByDayId = new Map<number, DeltaWorkout>();
  if (deltaWorkouts) {
    for (const d of deltaWorkouts) {
      if (d.changed) deltaByDayId.set(d.dayId, d);
    }
  }

  function handleDayClick(day: TrainingDay) {
    const match = matchByDayId.get(day.id);
    if (match?.matched) {
      setSidePanelMatch(match);
      setSidePanelDay(day);
    }
    onDayClick?.(day.id);
  }

  // Group days by week
  const weeks = new Map<number, TrainingDay[]>();
  for (const day of days) {
    const existing = weeks.get(day.week_number) || [];
    existing.push(day);
    weeks.set(day.week_number, existing);
  }

  // Determine current week from today's date
  const todayWeek = days.find((d) => d.day_date === today)?.week_number;
  const sortedWeeks = Array.from(weeks.entries()).sort(([a], [b]) => a - b);

  // Initialize expanded state: current week open, others collapsed
  const [expanded, setExpanded] = useState<Set<number>>(() => {
    const initial = new Set<number>();
    if (todayWeek) initial.add(todayWeek);
    else if (sortedWeeks.length > 0) initial.add(sortedWeeks[0][0]);
    return initial;
  });

  function toggleWeek(weekNum: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(weekNum)) next.delete(weekNum);
      else next.add(weekNum);
      return next;
    });
  }

  if (days.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          No training plan found. Create one via the sync pipeline to get started.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <ActivitySidePanel
        match={sidePanelMatch}
        onClose={() => {
          setSidePanelMatch(null);
          setSidePanelDay(null);
        }}
        planDay={
          sidePanelDay
            ? {
                run_type: sidePanelDay.run_type,
                run_title: sidePanelDay.run_title,
                target_distance_km: sidePanelDay.target_distance_km,
                workout_steps: sidePanelDay.workout_steps || [],
              }
            : undefined
        }
      />
      {sortedWeeks.map(([weekNum, weekDays]) => {
        const isExpanded = expanded.has(weekNum);
        const isCurrentWeek = weekNum === todayWeek;
        const weekKm = weekDays.reduce(
          (sum, d) => sum + (d.target_distance_km || 0),
          0
        );
        const runDays = weekDays.filter(
          (d) => d.run_type && d.run_type !== "rest"
        ).length;
        const completedCount = weekDays.filter((d) => d.completed).length;
        const actualKm = weekDays.reduce(
          (sum, d) => sum + (d.actual_distance_km || 0),
          0
        );
        const completionPct = weekKm > 0 ? Math.min(100, (actualKm / weekKm) * 100) : 0;

        return (
          <Card
            key={weekNum}
            className={cn(
              isCurrentWeek && "border-primary/40 shadow-[0_0_12px_var(--primary)/0.1]"
            )}
          >
            <CardHeader className="pb-0">
              <button
                onClick={() => toggleWeek(weekNum)}
                className="flex items-center justify-between w-full text-left group"
              >
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  {isCurrentWeek && (
                    <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                  )}
                  <span>
                    Week {weekNum}
                    {weekTitles[weekNum] && (
                      <span className="text-muted-foreground font-normal">
                        {" "}
                        &mdash; {weekTitles[weekNum]}
                      </span>
                    )}
                  </span>
                </CardTitle>
                <div className="flex items-center gap-3">
                  <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{weekKm.toFixed(1)} km</span>
                    <span>&middot;</span>
                    <span>{runDays} runs</span>
                    {actualKm > 0 && (
                      <>
                        <span>&middot;</span>
                        <span>{actualKm.toFixed(1)} km done</span>
                      </>
                    )}
                    {completedCount > 0 && (
                      <>
                        <span>&middot;</span>
                        <span className="text-green-400">
                          {completedCount}/{weekDays.length} done
                        </span>
                      </>
                    )}
                  </div>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 text-muted-foreground transition-transform duration-200",
                      isExpanded && "rotate-180"
                    )}
                  />
                </div>
              </button>
              {/* Volume progress bar */}
              <div className="w-full h-1 bg-muted/50 rounded-full mt-1">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${completionPct}%`,
                    backgroundColor: completionPct >= 100 ? "oklch(62% 0.17 142)" : "oklch(65% 0.15 250)",
                  }}
                />
              </div>
            </CardHeader>

            <div
              className={cn(
                "grid transition-all duration-200 ease-in-out",
                isExpanded
                  ? "grid-rows-[1fr] opacity-100"
                  : "grid-rows-[0fr] opacity-0"
              )}
            >
              <div className="overflow-hidden">
                <CardContent className="pt-4">
                  {/* Mobile summary */}
                  <div className="sm:hidden flex items-center gap-2 text-xs text-muted-foreground mb-3">
                    <span>{weekKm.toFixed(1)} km</span>
                    <span>&middot;</span>
                    <span>{runDays} runs</span>
                    {actualKm > 0 && (
                      <>
                        <span>&middot;</span>
                        <span>{actualKm.toFixed(1)} km done</span>
                      </>
                    )}
                    {completedCount > 0 && (
                      <>
                        <span>&middot;</span>
                        <span className="text-green-400">
                          {completedCount}/{weekDays.length} done
                        </span>
                      </>
                    )}
                  </div>

                  <div className="space-y-1">
                    {weekDays.map((day) => {
                      const isToday = day.day_date === today;
                      const isPast = day.day_date < today;
                      const isFuture = day.day_date > today;
                      const runColor =
                        runTypeColors[day.run_type] || runTypeColors.easy;
                      const match = matchByDayId.get(day.id);
                      const delta = deltaByDayId.get(day.id);
                      const projected = projectedDays?.find(p => p.dayId === day.id);
                      const hasDeltaOverlay = isFuture && !!delta;
                      const isClickable = isPast && match?.matched;

                      return (
                        <div
                          key={day.day_date}
                          className={cn(
                            "flex items-start gap-2 sm:gap-3 p-2 sm:p-2.5 rounded-lg transition-colors",
                            isToday
                              ? "bg-primary/10 ring-1 ring-primary/30"
                              : hasDeltaOverlay
                                ? "bg-yellow-500/10 ring-1 ring-yellow-500/20 hover:bg-yellow-500/15"
                                : "hover:bg-muted/50",
                            day.completed && "opacity-70",
                            isPast && !isToday && "opacity-60",
                            isClickable && "cursor-pointer",
                            sliderActive && projected && projected.paceChangePct !== 0
                              && "border-l-2 border-l-yellow-400/60",
                          )}
                          onClick={isClickable ? () => handleDayClick(day) : undefined}
                        >
                          {/* Date */}
                          <div className="w-[70px] sm:w-[90px] shrink-0 text-xs sm:text-sm text-muted-foreground tabular-nums">
                            {formatDate(day.day_date)}
                            {isToday && (
                              <div
                                className="text-[10px] font-medium mt-0.5"
                                style={{ color: "oklch(60% 0.2 300)" }}
                              >
                                TODAY
                              </div>
                            )}
                          </div>

                          {/* Run type badge */}
                          <div className="w-[72px] shrink-0">
                            {day.run_type && (
                              <span className="inline-flex items-center">
                                <Badge
                                  variant="secondary"
                                  className={cn(
                                    "text-[10px] capitalize",
                                    runColor.bg,
                                    runColor.text
                                  )}
                                >
                                  {day.run_type}
                                </Badge>
                                {projected?.trafficLight === "green" && (
                                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 ml-1" />
                                )}
                              </span>
                            )}
                          </div>

                          {/* Title & description */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <WorkoutCompletionButton dayId={day.id} completed={day.completed} />
                              <span
                                className={cn(
                                  "text-sm font-medium truncate",
                                  day.completed && "line-through",
                                )}
                              >
                                {day.run_title || "Rest"}
                              </span>
                              {/* Completion score badge for past matched days */}
                              {isPast && match?.matched && match.completionScore !== null && (
                                <span
                                  className={cn(
                                    "inline-flex items-center justify-center w-5 h-5 rounded-full text-[9px] font-bold tabular-nums shrink-0",
                                    match.completionScore >= 80
                                      ? "bg-green-500/20 text-green-400"
                                      : match.completionScore >= 60
                                        ? "bg-yellow-500/20 text-yellow-400"
                                        : "bg-red-500/20 text-red-400",
                                  )}
                                  title={`Completion score: ${match.completionScore}%`}
                                >
                                  {match.completionScore}
                                </span>
                              )}
                              {/* Garmin sync status indicators */}
                              {day.garmin_push_status === "pending" && (
                                <span className="text-xs text-yellow-400 shrink-0">&#x27F3; Syncing to Garmin</span>
                              )}
                              {(day.garmin_push_status === "pushed" || day.garmin_push_status === "success") && (
                                <span className="text-xs shrink-0" style={{ color: "oklch(62% 0.17 142)" }}>&#10003; On Garmin</span>
                              )}
                            </div>
                            {day.run_description && (
                              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                                {day.run_description}
                              </p>
                            )}
                            {day.workout_steps && Array.isArray(day.workout_steps) && day.workout_steps.length > 0 && (
                              <WorkoutStepEditor
                                steps={
                                  modifiedSteps.get(day.id)
                                  || (hasDeltaOverlay && delta?.adjustedSteps)
                                  || normalizeSteps(day.workout_steps)
                                }
                                isDelta={hasDeltaOverlay}
                                editable={!isPast}
                                onStepsChange={(newSteps) => handleStepChange(day.id, newSteps)}
                              />
                            )}
                            {/* Adaptation visualizations from forward simulation */}
                            {projected && projected.adjustedPace !== null && (
                              <div className="text-xs flex items-center gap-1 mt-0.5">
                                <span className="text-muted-foreground">
                                  {projected.effectiveRunType !== projected.runType
                                    ? projected.effectiveRunType : projected.runType}:
                                </span>
                                {projected.paceChangePct !== 0 ? (
                                  <>
                                    <span className="line-through opacity-40">
                                      {formatPace(projected.basePaceForType)}/km
                                    </span>
                                    <span className="opacity-40">&rarr;</span>
                                    <span style={{ color: projected.paceChangePct < 0 ? "oklch(0.7 0.15 142)" : "oklch(0.7 0.15 25)" }}>
                                      {formatPace(projected.adjustedPace)}/km
                                    </span>
                                    <span className="text-muted-foreground">
                                      ({projected.paceChangePct > 0 ? "+" : ""}{projected.paceChangePct}%)
                                    </span>
                                  </>
                                ) : (
                                  <span>{formatPace(projected.basePaceForType)}/km</span>
                                )}
                              </div>
                            )}
                            {projected?.hrZone && (
                              <div className="text-xs flex items-center gap-1 mt-0.5 text-muted-foreground">
                                <span className="font-medium" style={{
                                  color: projected.hrZone.zone === "Zone 2" ? "oklch(0.7 0.12 142)"
                                    : projected.hrZone.zone === "Zone 3" ? "oklch(0.7 0.12 85)"
                                    : projected.hrZone.zone === "Zone 4" ? "oklch(0.7 0.15 50)"
                                    : "oklch(0.7 0.18 25)"
                                }}>
                                  {projected.hrZone.zone}
                                </span>
                                <span>{projected.hrZone.low}–{projected.hrZone.high} bpm</span>
                              </div>
                            )}
                            {projected && projected.distanceChangePct !== 0 && (
                              <div className="text-xs flex items-center gap-1 mt-0.5">
                                <span className="line-through opacity-40">
                                  {projected.originalDistanceKm.toFixed(1)} km
                                </span>
                                <span className="opacity-40">&rarr;</span>
                                <span style={{ color: projected.distanceChangePct > 0 ? "oklch(0.7 0.15 142)" : "oklch(0.7 0.15 25)" }}>
                                  {projected.adjustedDistanceKm.toFixed(1)} km
                                </span>
                              </div>
                            )}
                            {projected && projected.isRest && !day.run_type?.includes("rest") && (
                              <div className="text-xs bg-red-500/20 text-red-300 px-1.5 py-0.5 rounded mt-1 w-fit">
                                REST — readiness critically low
                              </div>
                            )}
                            {projected && projected.trafficLight !== "green" && !projected.isRest && (
                              <div className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded mt-1 ${
                                projected.trafficLight === "yellow"
                                  ? "bg-yellow-500/20 text-yellow-300"
                                  : "bg-red-500/20 text-red-300"
                              }`}>
                                <span className={`inline-block w-2 h-2 rounded-full ${
                                  projected.trafficLight === "yellow" ? "bg-yellow-400" : "bg-red-400"
                                }`} />
                                {projected.trafficLight === "yellow" ? "Reduced" : "Rest recommended"}
                                {projected.effectiveRunType !== projected.runType && (
                                  <span className="opacity-60">
                                    {" "}({projected.runType} → {projected.effectiveRunType})
                                  </span>
                                )}
                              </div>
                            )}
                            {projected?.hasSequencingConflict && (
                              <span className="inline-block text-xs bg-yellow-500/20 text-yellow-300 px-1.5 py-0.5 rounded mt-1">
                                Legs yesterday — 48h rule
                              </span>
                            )}
                            {/* Pace waterfall breakdown */}
                            {projected && projected.adjustedPace !== null && projected.paceChangePct !== 0 && (
                              <div className="mt-2 pt-2 border-t border-border/20">
                                <PaceWaterfall
                                  basePace={projected.basePaceForType}
                                  items={[
                                    {
                                      label: "Readiness",
                                      seconds: projected.basePaceForType * (projected.readinessFactor - 1),
                                      color: projected.readinessFactor <= 1 ? "oklch(70% 0.15 142)" : "oklch(70% 0.15 25)",
                                    },
                                    {
                                      label: "Fatigue",
                                      seconds: projected.basePaceForType * (projected.fatigueFactor - 1),
                                      color: projected.fatigueFactor <= 1 ? "oklch(70% 0.15 142)" : "oklch(70% 0.15 25)",
                                    },
                                    {
                                      label: "Weight",
                                      seconds: projected.basePaceForType * (projected.weightFactor - 1),
                                      color: projected.weightFactor <= 1 ? "oklch(70% 0.15 142)" : "oklch(70% 0.15 25)",
                                    },
                                  ]}
                                  adjustedPace={projected.adjustedPace}
                                />
                              </div>
                            )}
                            {/* Gym notes (badge is in the header row) */}
                            {day.gym_workout && day.gym_notes && (
                              <p className="text-xs text-muted-foreground mt-2 border-t border-border/30 pt-2">{day.gym_notes}</p>
                            )}
                          </div>

                          {/* Distance */}
                          <div className="hidden sm:block w-[60px] shrink-0 text-right">
                            {day.target_distance_km > 0 && (
                              <span className="text-xs text-muted-foreground">
                                {day.target_distance_km.toFixed(1)} km
                              </span>
                            )}
                          </div>

                          {/* Gym badge */}
                          <div className="hidden sm:block w-[48px] shrink-0">
                            {day.gym_workout && (
                              <Badge
                                variant="secondary"
                                className="text-[10px] bg-violet-500/10 text-violet-400"
                                title={day.gym_notes || undefined}
                              >
                                <Dumbbell className="h-2.5 w-2.5 mr-0.5" />
                                {day.gym_workout}
                              </Badge>
                            )}
                          </div>

                          {/* Garmin push */}
                          <div className="w-[20px] shrink-0 flex justify-center">
                            <GarminPushButton
                              dayId={day.id}
                              status={day.garmin_push_status}
                              hasSteps={Array.isArray(day.workout_steps) && day.workout_steps.length > 0}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {weekNum === 5 && (
                    <div className="mt-4">
                      <RaceDayProtocol />
                    </div>
                  )}
                </CardContent>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
