"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { HRZoneChart } from "@/components/hr-zone-chart";
import { WorkoutHrTimeline } from "@/components/workout-hr-timeline";
import { HeartPulse, Flame, Dumbbell } from "lucide-react";

const KG_TO_LBS = 2.20462;

type WeightUnit = "kg" | "lbs";

function formatWeight(kg: number, unit: WeightUnit): string {
  if (unit === "lbs") return `${(kg * KG_TO_LBS).toFixed(1)} lbs`;
  return `${Number(kg).toFixed(1)} kg`;
}

function formatVolume(kg: number, unit: WeightUnit): string {
  if (unit === "lbs") return `${Math.round(kg * KG_TO_LBS).toLocaleString()} lbs`;
  return `${Math.round(kg).toLocaleString()} kg`;
}

interface WorkoutDetailModalProps {
  workoutId: string | null;
  onClose: () => void;
}

export function WorkoutDetailModal({ workoutId, onClose }: WorkoutDetailModalProps) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [unit, setUnit] = useState<WeightUnit>("kg");

  useEffect(() => {
    if (!workoutId) {
      setData(null);
      return;
    }
    setLoading(true);
    fetch(`/api/workout/${workoutId}`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [workoutId]);

  const exercises: any[] = data?.exercises || [];
  const durationMin = data
    ? Math.round(
        (new Date(data.end_time).getTime() - new Date(data.start_time).getTime()) / 60000
      )
    : 0;

  // Calculate totals (null-safe: sets may be missing)
  let totalSets = 0;
  let totalVolume = 0;
  let totalReps = 0;
  for (const ex of exercises) {
    const sets = Array.isArray(ex.sets) ? ex.sets : [];
    for (const s of sets) {
      if (s.type === "normal" && s.weight_kg > 0 && s.reps > 0) {
        totalSets++;
        totalReps += s.reps;
        totalVolume += s.weight_kg * s.reps;
      }
    }
  }

  // Compute avg HR for each set (ACTIVE + WARMUP) from the HR timeline
  const garminSetAvgHrs = useMemo(() => {
    if (!data?.garmin?.hr_timeline || !data?.garmin?.exercise_sets) return [];
    const timeline = data.garmin.hr_timeline as Array<{elapsed_sec: number; hr: number}>;
    const workingSets = (data.garmin.exercise_sets as Array<any>).filter(
      (s: any) => s.set_type === "ACTIVE" || s.set_type === "WARMUP"
    );

    return workingSets.map((s: any) => {
      const startSec = s.start_sec;
      const endSec = s.start_sec + s.duration_sec;
      const hrInSet = timeline.filter(
        (p) => p.elapsed_sec >= startSec && p.elapsed_sec <= endSec
      );
      if (hrInSet.length === 0) return null;
      return Math.round(hrInSet.reduce((sum, p) => sum + p.hr, 0) / hrInSet.length);
    });
  }, [data]);

  return (
    <Sheet open={!!workoutId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="text-lg">
            {loading ? "Loading..." : data?.title || "Workout"}
          </SheetTitle>
          {data && (
            <div className="text-sm text-muted-foreground">
              {new Date(data.start_time).toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </div>
          )}
        </SheetHeader>

        {loading && (
          <div className="flex items-center justify-center h-48 text-muted-foreground">
            Loading workout data...
          </div>
        )}

        {!loading && data && (
          <Tabs defaultValue="exercises" className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <TabsList className="grid grid-cols-3 flex-1">
              <TabsTrigger value="exercises">Exercises</TabsTrigger>
              <TabsTrigger value="summary">Summary</TabsTrigger>
              <TabsTrigger value="heartrate">Heart Rate</TabsTrigger>
              </TabsList>
              <button
                onClick={() => setUnit((u) => (u === "kg" ? "lbs" : "kg"))}
                className="ml-2 px-2 py-1 rounded-md text-[10px] font-medium border border-border bg-muted/50 hover:bg-accent/50 transition-colors shrink-0"
              >
                {unit === "kg" ? "kg → lbs" : "lbs → kg"}
              </button>
            </div>

            <ScrollArea className="h-[calc(100vh-180px)] mt-4">
              <TabsContent value="exercises" className="space-y-4 px-4 pb-8">
                {exercises.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-32 text-muted-foreground space-y-2">
                    <Dumbbell className="h-8 w-8 opacity-30" />
                    <p className="text-sm">No exercise data recorded</p>
                  </div>
                )}
                {(() => {
                  let garminSetIdx = 0;
                  return exercises.map((ex: any, ei: number) => {
                    const sets = Array.isArray(ex.sets) ? ex.sets : [];
                    const maxWeight = Math.max(
                      ...sets.filter((s: any) => s.weight_kg > 0).map((s: any) => s.weight_kg),
                      0
                    );
                    return (
                      <div key={ei} className="border border-border/50 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2">
                          <div className="font-medium text-sm">{ex.title}</div>
                          {ex.muscle_group && (
                            <Badge variant="outline" className="text-xs capitalize">
                              {ex.muscle_group}
                            </Badge>
                          )}
                        </div>
                        <div className="space-y-1">
                          {sets.map((s: any, si: number) => {
                            const avgHr = garminSetAvgHrs[garminSetIdx++] ?? null;
                            return (
                              <div
                                key={si}
                                className={`flex items-center gap-3 text-xs py-1 ${
                                  s.type === "warmup"
                                    ? "text-muted-foreground"
                                    : ""
                                }`}
                              >
                                <span className="w-6">
                                  {s.type === "warmup" ? "W" : si + 1 - sets.filter((ss: any, ssi: number) => ssi < si && ss.type === "warmup").length}
                                </span>
                                <span className="w-20">
                                  {s.weight_kg > 0
                                    ? formatWeight(s.weight_kg, unit)
                                    : "BW"}
                                </span>
                                <span className="w-10">
                                  {s.reps > 0 ? `${s.reps} reps` : "—"}
                                </span>
                                {s.type === "warmup" && (
                                  <Badge variant="secondary" className="text-[10px] h-4">
                                    warmup
                                  </Badge>
                                )}
                                {s.weight_kg === maxWeight && s.type !== "warmup" && maxWeight > 0 && (
                                  <Badge className="text-[10px] h-4 bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
                                    top
                                  </Badge>
                                )}
                                {avgHr != null && (
                                  <span className="text-[10px] text-red-400 ml-auto flex items-center gap-0.5">
                                    <HeartPulse className="h-2.5 w-2.5" />
                                    {avgHr}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        {ex.notes && (
                          <div className="mt-2 text-xs text-muted-foreground italic">
                            {ex.notes}
                          </div>
                        )}
                      </div>
                    );
                  });
                })()}
              </TabsContent>

              <TabsContent value="summary" className="space-y-4 px-4 pb-8">
                <div className="grid grid-cols-2 gap-3">
                  <MetricBox label="Duration" value={`${durationMin}m`} />
                  <MetricBox label="Exercises" value={`${exercises.length}`} />
                  <MetricBox label="Working Sets" value={`${totalSets}`} />
                  <MetricBox label="Total Reps" value={`${totalReps}`} />
                  <MetricBox
                    label="Total Volume"
                    value={formatVolume(totalVolume, unit)}
                  />
                  {data.garmin?.calories ? (
                    <MetricBox
                      label="Calories (Garmin)"
                      value={`${Math.round(data.garmin.calories)} kcal`}
                    />
                  ) : (
                    <MetricBox
                      label="Avg Volume/Set"
                      value={
                        totalSets > 0
                          ? formatVolume(totalVolume / totalSets, unit)
                          : "—"
                      }
                    />
                  )}
                </div>

                {/* Muscle groups used */}
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                    Muscle Groups
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {Array.from(
                      new Set(
                        exercises
                          .map((e: any) => e.muscle_group)
                          .filter(Boolean)
                      )
                    ).map((mg: any) => (
                      <Badge key={mg} variant="outline" className="text-xs capitalize">
                        {mg}
                      </Badge>
                    ))}
                  </div>
                </div>

                {/* Per-exercise volume breakdown */}
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                    Volume by Exercise
                  </h4>
                  <div className="space-y-2">
                    {exercises.map((ex: any, i: number) => {
                      let vol = 0;
                      let sets = 0;
                      const exSets = Array.isArray(ex.sets) ? ex.sets : [];
                      for (const s of exSets) {
                        if (s.type === "normal" && s.weight_kg > 0 && s.reps > 0) {
                          vol += s.weight_kg * s.reps;
                          sets++;
                        }
                      }
                      return (
                        <div key={i} className="flex items-center justify-between text-xs">
                          <span className="truncate mr-2">{ex.title}</span>
                          <span className="text-muted-foreground shrink-0">
                            {formatVolume(vol, unit)} · {sets} sets
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="heartrate" className="space-y-4 px-4 pb-8">
                {data.garmin ? (
                  <>
                    <div className="grid grid-cols-3 gap-3">
                      <MetricBox
                        label="Avg HR"
                        value={data.garmin.avg_hr ? `${Math.round(data.garmin.avg_hr)} bpm` : "—"}
                      />
                      <MetricBox
                        label="Max HR"
                        value={data.garmin.max_hr ? `${Math.round(data.garmin.max_hr)} bpm` : "—"}
                      />
                      <MetricBox
                        label="Calories"
                        value={data.garmin.calories ? `${Math.round(data.garmin.calories)}` : "—"}
                      />
                    </div>

                    {data.garmin.hr_timeline && data.garmin.hr_timeline.length > 0 ? (
                      <WorkoutHrTimeline
                        hrTimeline={data.garmin.hr_timeline}
                        exerciseSets={data.garmin.exercise_sets}
                      />
                    ) : data.garmin.hr_zones && data.garmin.hr_zones.length > 0 ? (
                      <div>
                        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                          HR Zones
                        </h4>
                        <HRZoneChart zones={data.garmin.hr_zones} />
                        <p className="text-xs text-muted-foreground mt-2 italic">
                          Detailed HR data not available for this workout.
                        </p>
                      </div>
                    ) : null}

                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Badge variant="outline" className="text-[10px] h-4 bg-green-500/10 text-green-400 border-green-500/30">
                        Garmin
                      </Badge>
                      <span>Matched from Garmin strength training activity</span>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center h-48 text-muted-foreground space-y-2">
                    <HeartPulse className="h-8 w-8 opacity-30" />
                    <p className="text-sm">No heart rate data</p>
                    <p className="text-xs">No matching Garmin activity found</p>
                  </div>
                )}
              </TabsContent>
            </ScrollArea>
          </Tabs>
        )}
      </SheetContent>
    </Sheet>
  );
}

function MetricBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border/50 rounded-lg p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-bold mt-0.5">{value}</div>
    </div>
  );
}
