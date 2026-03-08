"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Target, Calendar, Trophy } from "lucide-react";

interface RaceCountdownProps {
  raceName: string;
  raceDate: string;
  goalTimeSeconds: number;
  totalWeeks: number;
  currentWeek: number;
  completedDays: number;
  totalDays: number;
}

function formatGoalTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}:${m.toString().padStart(2, "0")}`;
}

export function RaceCountdown({
  raceName,
  raceDate,
  goalTimeSeconds,
  totalWeeks,
  currentWeek,
  completedDays,
  totalDays,
}: RaceCountdownProps) {
  const now = new Date();
  const race = new Date(raceDate + "T00:00:00");
  const daysUntil = Math.max(
    0,
    Math.ceil((race.getTime() - now.getTime()) / 86400000)
  );
  const progressPct = Math.min(
    100,
    Math.round((completedDays / totalDays) * 100)
  );

  // Goal times: A = goal, B = goal + 5min, C = goal + 8min
  const goalA = goalTimeSeconds;
  const goalB = goalTimeSeconds + 300;
  const goalC = goalTimeSeconds + 480;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Target className="h-4 w-4" style={{ color: "oklch(60% 0.2 300)" }} />
          Race Countdown
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8">
          {/* Days until race */}
          <div className="text-center sm:text-left shrink-0">
            <div
              className="text-5xl font-bold tabular-nums"
              style={{ color: "oklch(60% 0.2 300)" }}
            >
              {daysUntil}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              days until race
            </div>
          </div>

          {/* Info */}
          <div className="flex-1 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-lg">{raceName}</span>
              <Badge variant="secondary" className="text-[10px]">
                <Calendar className="h-3 w-3 mr-1" />
                {new Date(raceDate + "T00:00:00").toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </Badge>
            </div>

            {/* Goal times */}
            <div className="flex items-center gap-3 text-sm">
              <Trophy className="h-4 w-4 text-amber-400 shrink-0" />
              <div className="flex gap-3">
                <span>
                  <span
                    className="font-bold"
                    style={{ color: "oklch(62% 0.17 142)" }}
                  >
                    A
                  </span>{" "}
                  {formatGoalTime(goalA)}
                </span>
                <span>
                  <span
                    className="font-bold"
                    style={{ color: "oklch(65% 0.2 55)" }}
                  >
                    B
                  </span>{" "}
                  {formatGoalTime(goalB)}
                </span>
                <span>
                  <span className="font-bold text-muted-foreground">C</span>{" "}
                  {formatGoalTime(goalC)}
                </span>
              </div>
            </div>

            {/* Progress */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  Week {currentWeek} of {totalWeeks}
                </span>
                <span>{progressPct}% complete</span>
              </div>
              <Progress value={progressPct} className="h-2" />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
