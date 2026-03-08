"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, Dumbbell } from "lucide-react";
import { cn } from "@/lib/utils";
import { WorkoutCompletionButton } from "@/components/workout-completion-button";
import { GarminPushButton } from "@/components/garmin-push-button";

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
  completed: boolean;
  garmin_push_status: string;
  plan_name: string;
  race_date: string;
  goal_time_seconds: number;
}

interface TrainingPlanViewProps {
  days: TrainingDay[];
  today: string;
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


export function TrainingPlanView({ days, today }: TrainingPlanViewProps) {
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
                      const runColor =
                        runTypeColors[day.run_type] || runTypeColors.easy;

                      return (
                        <div
                          key={day.day_date}
                          className={cn(
                            "flex items-start gap-2 sm:gap-3 p-2 sm:p-2.5 rounded-lg transition-colors",
                            isToday
                              ? "bg-primary/10 ring-1 ring-primary/30"
                              : "hover:bg-muted/50",
                            day.completed && "opacity-70"
                          )}
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
                            )}
                          </div>

                          {/* Title & description */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <WorkoutCompletionButton dayId={day.id} completed={day.completed} />
                              <span
                                className={cn(
                                  "text-sm font-medium truncate",
                                  day.completed && "line-through"
                                )}
                              >
                                {day.run_title || "Rest"}
                              </span>
                            </div>
                            {day.run_description && (
                              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                                {day.run_description}
                              </p>
                            )}
                            {day.workout_steps && Array.isArray(day.workout_steps) && day.workout_steps.length > 0 && (
                              <div className="mt-1.5 space-y-0.5">
                                {day.workout_steps.map((step: any, i: number) => (
                                  <div key={i} className="flex items-center gap-2 text-[10px] text-muted-foreground/70">
                                    <span className="w-1 h-1 rounded-full bg-muted-foreground/40 shrink-0" />
                                    <span>{step.name || step.type}</span>
                                    {step.target_pace && (
                                      <span className="font-mono">@ {formatPace(step.target_pace)}/km</span>
                                    )}
                                    {step.distance_meters && (
                                      <span>{(step.distance_meters / 1000).toFixed(1)}km</span>
                                    )}
                                    {step.duration_minutes && (
                                      <span>{step.duration_minutes}min</span>
                                    )}
                                    {step.repeats && step.repeats > 1 && (
                                      <span>&times;{step.repeats}</span>
                                    )}
                                  </div>
                                ))}
                              </div>
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
                </CardContent>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
