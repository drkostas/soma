"use client";

import { useState, useEffect } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

interface WorkoutDetailModalProps {
  workoutId: string | null;
  onClose: () => void;
}

export function WorkoutDetailModal({ workoutId, onClose }: WorkoutDetailModalProps) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

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

  // Calculate totals
  let totalSets = 0;
  let totalVolume = 0;
  let totalReps = 0;
  for (const ex of exercises) {
    for (const s of ex.sets) {
      if (s.type === "normal" && s.weight_kg > 0 && s.reps > 0) {
        totalSets++;
        totalReps += s.reps;
        totalVolume += s.weight_kg * s.reps;
      }
    }
  }

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
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="exercises">Exercises</TabsTrigger>
              <TabsTrigger value="summary">Summary</TabsTrigger>
            </TabsList>

            <ScrollArea className="h-[calc(100vh-200px)] mt-4">
              <TabsContent value="exercises" className="space-y-4 pr-4">
                {exercises.map((ex: any, ei: number) => {
                  const workingSets = ex.sets.filter(
                    (s: any) => s.type === "normal" && s.weight_kg > 0
                  );
                  const maxWeight = Math.max(
                    ...ex.sets.filter((s: any) => s.weight_kg > 0).map((s: any) => s.weight_kg),
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
                        {ex.sets.map((s: any, si: number) => (
                          <div
                            key={si}
                            className={`flex items-center gap-3 text-xs py-1 ${
                              s.type === "warmup"
                                ? "text-muted-foreground"
                                : ""
                            }`}
                          >
                            <span className="w-6">
                              {s.type === "warmup" ? "W" : si + 1 - ex.sets.filter((ss: any, ssi: number) => ssi < si && ss.type === "warmup").length}
                            </span>
                            <span className="w-16">
                              {s.weight_kg > 0
                                ? `${Number(s.weight_kg).toFixed(1)} kg`
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
                          </div>
                        ))}
                      </div>
                      {ex.notes && (
                        <div className="mt-2 text-xs text-muted-foreground italic">
                          {ex.notes}
                        </div>
                      )}
                    </div>
                  );
                })}
              </TabsContent>

              <TabsContent value="summary" className="space-y-4 pr-4">
                <div className="grid grid-cols-2 gap-3">
                  <MetricBox label="Duration" value={`${durationMin}m`} />
                  <MetricBox label="Exercises" value={`${exercises.length}`} />
                  <MetricBox label="Working Sets" value={`${totalSets}`} />
                  <MetricBox label="Total Reps" value={`${totalReps}`} />
                  <MetricBox
                    label="Total Volume"
                    value={`${Math.round(totalVolume).toLocaleString()} kg`}
                  />
                  <MetricBox
                    label="Avg Volume/Set"
                    value={
                      totalSets > 0
                        ? `${Math.round(totalVolume / totalSets)} kg`
                        : "—"
                    }
                  />
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
                      for (const s of ex.sets) {
                        if (s.type === "normal" && s.weight_kg > 0 && s.reps > 0) {
                          vol += s.weight_kg * s.reps;
                          sets++;
                        }
                      }
                      return (
                        <div key={i} className="flex items-center justify-between text-xs">
                          <span className="truncate mr-2">{ex.title}</span>
                          <span className="text-muted-foreground shrink-0">
                            {Math.round(vol)} kg · {sets} sets
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
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
