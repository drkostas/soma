"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "lucide-react";
import { ExerciseDetailModal } from "@/components/exercise-detail-modal";

interface WeekData {
  week: string;
  workouts: number;
  avg_duration: number;
  details: {
    title: string;
    date: string;
    exercises: string[];
    duration_min: number;
  }[];
}

function formatWeekLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const end = new Date(d.getTime() + 6 * 86400000);
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${end.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

export function ClickableWeeklyFrequency({ data }: { data: WeekData[] }) {
  const [selectedWeek, setSelectedWeek] = useState<WeekData | null>(null);
  const [selectedExercise, setSelectedExercise] = useState<string | null>(null);

  const weeks = data.slice(-52);
  const maxW = Math.max(...weeks.map(x => x.workouts));

  const recent12 = weeks.slice(-12);
  const avg12 = recent12.reduce((s, w) => s + w.workouts, 0) / (recent12.length || 1);

  return (
    <>
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Calendar className="h-4 w-4 text-blue-400" />
            Weekly Workout Frequency
            <span className="ml-auto text-xs font-normal">
              12-week avg: {avg12.toFixed(1)}/week
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-[2px] h-24">
            {weeks.map((w, i) => {
              const count = w.workouts;
              const pct = maxW > 0 ? (count / maxW) * 100 : 0;
              const weekDate = new Date(w.week + "T00:00:00");
              const label = weekDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
              const color = count >= 4 ? "bg-green-500" :
                count >= 3 ? "bg-green-400/80" :
                count >= 2 ? "bg-primary/60" :
                count >= 1 ? "bg-primary/30" : "bg-muted/30";
              return (
                <div
                  key={i}
                  className="flex-1 flex items-end justify-center cursor-pointer group"
                  style={{ height: "80px" }}
                  onClick={() => count > 0 && setSelectedWeek(w)}
                >
                  <div
                    className={`w-full rounded-t-sm ${color} group-hover:opacity-80 transition-opacity`}
                    style={{ height: `${Math.max(pct, count > 0 ? 6 : 0)}%` }}
                    title={`${label}: ${count} workouts · ${w.avg_duration}m avg`}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex gap-[2px] mt-1">
            {weeks.map((w, i) => {
              const d = new Date(w.week + "T00:00:00");
              const prev = i > 0 ? new Date(weeks[i - 1].week + "T00:00:00") : null;
              const isNewMonth = !prev || d.getMonth() !== prev.getMonth();
              return (
                <div key={i} className="flex-1 text-[9px] text-muted-foreground overflow-hidden">
                  {isNewMonth ? d.toLocaleDateString("en-US", { month: "short" }) : ""}
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground justify-center">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-primary/30" /> 1</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-primary/60" /> 2</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-green-400/80" /> 3</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-green-500" /> 4+</span>
            <span className="text-muted-foreground/50 ml-1">workouts/week · click bars for details</span>
          </div>
        </CardContent>
      </Card>

      {/* Week detail sheet */}
      <Sheet open={!!selectedWeek} onOpenChange={(open) => !open && setSelectedWeek(null)}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          {selectedWeek && (
            <>
              <SheetHeader className="mb-4">
                <SheetTitle>Week of {formatWeekLabel(selectedWeek.week)}</SheetTitle>
                <div className="text-sm text-muted-foreground">
                  {selectedWeek.workouts} workouts · {selectedWeek.avg_duration}m avg
                </div>
              </SheetHeader>

              <div className="space-y-3">
                {selectedWeek.details.map((workout, i) => (
                  <div key={i} className="border border-border/50 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium">{workout.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(workout.date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mb-2">{workout.duration_min}m</div>
                    <div className="flex flex-wrap gap-1">
                      {workout.exercises.map((ex, j) => (
                        <Badge
                          key={j}
                          variant="outline"
                          className="text-[10px] cursor-pointer hover:bg-accent/20 transition-colors"
                          onClick={() => setSelectedExercise(ex)}
                        >
                          {ex}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <ExerciseDetailModal exerciseName={selectedExercise} onClose={() => setSelectedExercise(null)} />
    </>
  );
}
