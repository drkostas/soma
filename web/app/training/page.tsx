import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/stat-card";
import { RaceCountdown } from "@/components/race-countdown";
import { TrainingPlanView } from "@/components/training-plan-view";
import { getDb } from "@/lib/db";
import { Target, Footprints, Dumbbell, CalendarCheck } from "lucide-react";

export const metadata: Metadata = { title: "Training" };
export const revalidate = 300;

async function getTrainingPlan() {
  const sql = getDb();
  return sql`
    SELECT d.*, p.plan_name, p.race_date::text as race_date, p.goal_time_seconds
    FROM training_plan_day d
    JOIN training_plan p ON d.plan_id = p.id
    WHERE p.status = 'active'
    ORDER BY d.day_date
  `;
}

async function getRaceInfo() {
  const sql = getDb();
  const rows = await sql`
    SELECT race_date::text as race_date, goal_time_seconds, plan_name
    FROM training_plan
    WHERE status = 'active'
    LIMIT 1
  `;
  return rows[0] || null;
}

export default async function TrainingPage() {
  const [planDays, raceInfo] = await Promise.all([
    getTrainingPlan(),
    getRaceInfo(),
  ]);

  const today = new Date().toISOString().split("T")[0];

  // Compute stats
  const totalWeeks = planDays.length > 0
    ? Math.max(...planDays.map((d: any) => d.week_number))
    : 0;

  const todayEntry = planDays.find((d: any) => d.day_date === today);
  const currentWeek = todayEntry?.week_number ?? 1;

  const completedDays = planDays.filter((d: any) => d.completed).length;
  const totalDays = planDays.length;

  // This week's days
  const thisWeekDays = planDays.filter(
    (d: any) => d.week_number === currentWeek
  );
  const thisWeekKm = thisWeekDays.reduce(
    (sum: number, d: any) => sum + (d.target_distance_km || 0),
    0
  );
  const thisWeekRuns = thisWeekDays.filter(
    (d: any) => d.run_type && d.run_type !== "rest"
  ).length;
  const thisWeekGym = thisWeekDays.filter(
    (d: any) => d.gym_workout
  ).length;
  const thisWeekCompleted = thisWeekDays.filter(
    (d: any) => d.completed
  ).length;

  // Total plan distance
  const totalPlanKm = planDays.reduce(
    (sum: number, d: any) => sum + (d.target_distance_km || 0),
    0
  );

  const hasNoPlan = planDays.length === 0;

  return (
    <div className="container mx-auto px-3 sm:px-6 py-4 sm:py-8 max-w-7xl">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Training
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {hasNoPlan
              ? "No active training plan."
              : `${raceInfo?.plan_name || "Training Plan"} — ${totalDays} days, ${totalPlanKm.toFixed(0)} km total`}
          </p>
        </div>
      </div>

      {hasNoPlan ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Target
              className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50"
            />
            <h2 className="text-lg font-semibold mb-2">No Active Training Plan</h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Create a training plan via the sync pipeline to see your schedule,
              race countdown, and weekly breakdown here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Race Countdown */}
          {raceInfo && (
            <div className="mb-6">
              <RaceCountdown
                raceName={raceInfo.plan_name}
                raceDate={raceInfo.race_date}
                goalTimeSeconds={Number(raceInfo.goal_time_seconds)}
                totalWeeks={totalWeeks}
                currentWeek={currentWeek}
                completedDays={completedDays}
                totalDays={totalDays}
              />
            </div>
          )}

          {/* This Week Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <StatCard
              title="This Week"
              value={`${thisWeekKm.toFixed(1)} km`}
              subtitle={`Week ${currentWeek} target`}
              icon={
                <Footprints className="h-4 w-4" style={{ color: "oklch(65% 0.15 250)" }} />
              }
            />
            <StatCard
              title="Run Sessions"
              value={thisWeekRuns}
              subtitle={`${thisWeekCompleted} completed`}
              icon={
                <CalendarCheck
                  className="h-4 w-4"
                  style={{ color: "oklch(62% 0.17 142)" }}
                />
              }
            />
            <StatCard
              title="Gym Sessions"
              value={thisWeekGym}
              subtitle="this week"
              icon={
                <Dumbbell
                  className="h-4 w-4"
                  style={{ color: "oklch(60% 0.2 300)" }}
                />
              }
            />
            <StatCard
              title="Plan Progress"
              value={`${completedDays}/${totalDays}`}
              subtitle={`${Math.round((completedDays / totalDays) * 100)}% done`}
              icon={
                <Target
                  className="h-4 w-4"
                  style={{ color: "oklch(65% 0.2 55)" }}
                />
              }
            />
          </div>

          {/* This Week's Schedule - quick 7-day row */}
          <Card className="mb-6">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Week {currentWeek} Schedule
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-7 gap-1 sm:gap-2">
                {thisWeekDays.map((day: any) => {
                  const isToday = day.day_date === today;
                  const dayName = new Date(
                    day.day_date + "T00:00:00"
                  ).toLocaleDateString("en-US", { weekday: "short" });
                  const typeColors: Record<string, string> = {
                    rest: "border-zinc-500/30",
                    easy: "border-green-500/50",
                    recovery: "border-green-500/50",
                    tempo: "border-orange-500/50",
                    intervals: "border-orange-500/50",
                    threshold: "border-orange-500/50",
                    long: "border-blue-500/50",
                    race: "border-purple-500/50",
                  };
                  const borderClass =
                    typeColors[day.run_type] || "border-muted";

                  return (
                    <div
                      key={day.day_date}
                      className={`flex flex-col items-center p-1.5 sm:p-2 rounded-lg border text-center transition-all ${borderClass} ${
                        isToday
                          ? "bg-primary/10 ring-1 ring-primary/40"
                          : "bg-muted/30"
                      } ${day.completed ? "opacity-60" : ""}`}
                    >
                      <div className="text-[10px] text-muted-foreground">
                        {dayName}
                      </div>
                      <div
                        className={`text-xs sm:text-sm font-medium mt-0.5 truncate w-full ${
                          day.run_type === "rest"
                            ? "text-muted-foreground"
                            : ""
                        }`}
                      >
                        {day.run_type === "rest"
                          ? "Rest"
                          : day.run_title || day.run_type || "--"}
                      </div>
                      {day.target_distance_km > 0 && (
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {day.target_distance_km.toFixed(1)}km
                        </div>
                      )}
                      {day.completed && (
                        <div
                          className="text-[10px] mt-0.5 font-medium"
                          style={{ color: "oklch(62% 0.17 142)" }}
                        >
                          Done
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Full 5-Week Plan */}
          <div className="mb-6">
            <h2 className="text-sm font-medium text-muted-foreground mb-3">
              Full Plan
            </h2>
            <TrainingPlanView days={planDays as any} today={today} />
          </div>
        </>
      )}
    </div>
  );
}
