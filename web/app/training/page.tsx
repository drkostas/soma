import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/stat-card";
import { RaceCountdown } from "@/components/race-countdown";
import { RaceSplitsCard } from "@/components/race-splits-card";
import { TrainingPlanView } from "@/components/training-plan-view";
import { ReadinessCard } from "@/components/readiness-card";
import { PMCChart } from "@/components/pmc-chart";
import { FitnessTrajectoryChart } from "@/components/fitness-trajectory-chart";
import { DataProvenanceCard } from "@/components/data-provenance-card";
import { PaceAdjustmentCard } from "@/components/pace-adjustment-card";
import { TrainingPacesCard } from "@/components/training-paces-card";
import { DeltaSimulator } from "@/components/delta-simulator";
import { TrajectoryChart } from "@/components/trajectory-chart";
import { ExpandableChartCard } from "@/components/expandable-chart-card";
import { getDb } from "@/lib/db";
import { Target, Footprints, Dumbbell, CalendarCheck, TrendingUp } from "lucide-react";
import { TrainingControls } from "@/components/training-controls";
import { TodaysRecommendation } from "@/components/todays-recommendation";

export const metadata: Metadata = { title: "Training" };
export const revalidate = 300;

async function getTrainingPlan() {
  const sql = getDb();
  return sql`
    SELECT d.*, d.day_date::text as day_date,
           p.plan_name, p.race_date::text as race_date, p.goal_time_seconds
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

async function getReadiness() {
  const sql = getDb();
  const rows = await sql`
    SELECT hrv_z_score, sleep_z_score, rhr_z_score,
           body_battery_z_score, composite_score, traffic_light, flags
    FROM daily_readiness
    ORDER BY date DESC
    LIMIT 1
  `;
  return rows[0] || null;
}

async function getPMC() {
  const sql = getDb();
  return sql`
    SELECT date::text as date, ctl, atl, tsb
    FROM pmc_daily
    WHERE date >= NOW() - INTERVAL '90 days'
    ORDER BY date
  `;
}

async function getFitnessTrajectory() {
  const sql = getDb();
  return sql`
    SELECT date::text as date, vo2max, efficiency_factor, decoupling_pct, vdot_adjusted
    FROM fitness_trajectory
    WHERE date >= NOW() - INTERVAL '90 days'
    ORDER BY date
  `;
}

async function getPaceAdjustment() {
  const sql = getDb();
  const readiness = await sql`
    SELECT composite_score, traffic_light FROM daily_readiness ORDER BY date DESC LIMIT 1
  `;
  const pmc = await sql`
    SELECT tsb FROM pmc_daily ORDER BY date DESC LIMIT 1
  `;
  const weight = await sql`
    SELECT weight_kg, vdot_adjusted FROM fitness_trajectory
    WHERE weight_kg IS NOT NULL ORDER BY date DESC LIMIT 1
  `;
  if (!readiness[0] || !pmc[0]) return null;

  const compositeScore = Number(readiness[0].composite_score || 0);
  const tsb = Number(pmc[0].tsb || 0);

  // Readiness factor (mirrors merge.py)
  let rf = 1.0;
  if (compositeScore <= -2.0) return null;
  if (compositeScore >= 1.0) rf = 0.97;
  else if (compositeScore >= 0) rf = 1.00 - 0.03 * compositeScore;
  else if (compositeScore >= -1.0) rf = 1.00 - 0.05 * compositeScore;
  else rf = 1.05;

  // Fatigue factor (mirrors merge.py)
  let ff = 1.0;
  if (tsb >= 10) ff = 0.98;
  else if (tsb <= -20) ff = 1.03;
  else if (tsb >= 0) ff = 1.00 - 0.002 * tsb;
  else ff = 1.00 - 0.0015 * tsb;

  // Weight factor
  const calibrationWeight = 80.5;
  let wf = 1.0;
  if (weight[0]?.weight_kg) {
    wf = Number(weight[0].weight_kg) / calibrationWeight;
  }

  const basePace = 284; // B-goal 4:44/km
  return {
    base_pace: basePace,
    readiness_factor: rf,
    fatigue_factor: ff,
    weight_factor: wf,
    adjusted_pace: basePace * rf * ff * wf,
    traffic_light: readiness[0].traffic_light,
  };
}

async function getTrajectoryData(raceDate: string) {
  const sql = getDb();
  const actuals = await sql`
    SELECT date::text as date, vo2max
    FROM fitness_trajectory
    WHERE vo2max IS NOT NULL
    ORDER BY date
  `;

  if (actuals.length === 0) return [];

  const currentVo2 = Number(actuals[actuals.length - 1].vo2max);
  const goalVo2 = 52; // VDOT needed for A-goal (1:35)

  const start = new Date(actuals[0].date + "T00:00:00");
  const end = new Date(raceDate + "T00:00:00");
  const totalDays = Math.max(1, (end.getTime() - start.getTime()) / 86400000);

  const actualMap = new Map(actuals.map((a: any) => [a.date, Number(a.vo2max)]));

  const trajectory: { date: string; optimal: number; actual: number | null }[] = [];
  const current = new Date(start);
  while (current <= end) {
    const dateStr = current.toISOString().split("T")[0];
    const dayNum = (current.getTime() - start.getTime()) / 86400000;
    // Logistic S-curve: fast early gains, plateau, slight taper supercompensation
    const progress = dayNum / totalDays;
    // S-curve: sigmoid with steeper early phase
    const sCurve = 1 / (1 + Math.exp(-8 * (progress - 0.4)));
    // Taper bump: small supercompensation in last 15% of plan
    const taperBump = progress > 0.85 ? 0.3 * Math.sin((progress - 0.85) / 0.15 * Math.PI) : 0;
    const optimal = currentVo2 + (goalVo2 - currentVo2) * (sCurve + taperBump * 0.1);
    trajectory.push({
      date: dateStr,
      optimal,
      actual: actualMap.get(dateStr) ?? null,
    });
    current.setDate(current.getDate() + 1);
  }

  return trajectory;
}

export default async function TrainingPage() {
  const [planDays, raceInfo, readiness, pmcData, fitnessData, paceData] = await Promise.all([
    getTrainingPlan(),
    getRaceInfo(),
    getReadiness(),
    getPMC(),
    getFitnessTrajectory(),
    getPaceAdjustment(),
  ]);

  const today = new Date().toISOString().split("T")[0];

  // Trajectory data (depends on raceInfo)
  const trajectoryData = raceInfo ? await getTrajectoryData(raceInfo.race_date) : [];

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

  // Build provenance data from readiness + pmc + fitness
  const provenanceData = readiness && pmcData.length > 0 ? {
    hrv_z: readiness.hrv_z_score != null ? Number(readiness.hrv_z_score) : null,
    sleep_z: readiness.sleep_z_score != null ? Number(readiness.sleep_z_score) : null,
    rhr_z: readiness.rhr_z_score != null ? Number(readiness.rhr_z_score) : null,
    bb_z: readiness.body_battery_z_score != null ? Number(readiness.body_battery_z_score) : null,
    ctl: Number(pmcData[pmcData.length - 1]?.ctl || 0),
    atl: Number(pmcData[pmcData.length - 1]?.atl || 0),
    tsb: Number(pmcData[pmcData.length - 1]?.tsb || 0),
    vo2max: fitnessData.length > 0 ? fitnessData[fitnessData.length - 1]?.vo2max : null,
    weight_kg: fitnessData.length > 0 ? fitnessData[fitnessData.length - 1]?.weight_kg : null,
    decoupling_pct: fitnessData.length > 0 ? fitnessData[fitnessData.length - 1]?.decoupling_pct : null,
  } : null;

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
        {!hasNoPlan && <TrainingControls />}
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
          {/* Race Countdown + Splits */}
          {raceInfo && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <RaceCountdown
                raceName={raceInfo.plan_name}
                raceDate={raceInfo.race_date}
                goalTimeSeconds={Number(raceInfo.goal_time_seconds)}
                totalWeeks={totalWeeks}
                currentWeek={currentWeek}
                completedDays={completedDays}
                totalDays={totalDays}
              />
              <RaceSplitsCard />
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

          {/* Today's Recommendation */}
          {todayEntry && (
            <div className="mb-6">
              <TodaysRecommendation
                trafficLight={readiness?.traffic_light || "green"}
                runType={todayEntry.run_type}
                runTitle={todayEntry.run_title}
                targetKm={todayEntry.target_distance_km}
                adjustedPace={paceData?.adjusted_pace ?? null}
                compositeScore={Number(readiness?.composite_score || 0)}
              />
            </div>
          )}

          {/* Readiness + Provenance + PMC Row */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <ReadinessCard data={readiness as any} />
            <DataProvenanceCard data={provenanceData as any} />
            <div className="md:col-span-2">
              <ExpandableChartCard
                title="Performance Management"
                subtitle="CTL / ATL / TSB"
                icon={<TrendingUp className="h-4 w-4" style={{ color: "oklch(65% 0.15 250)" }} />}
              >
                <PMCChart data={pmcData as any} raceDate={raceInfo?.race_date} />
              </ExpandableChartCard>
            </div>
          </div>

          {/* Pace + Paces + Fitness Trajectory Row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="space-y-4">
              <PaceAdjustmentCard data={paceData as any} />
              <TrainingPacesCard />
              {paceData && (
                <DeltaSimulator
                  basePace={paceData.adjusted_pace}
                  optimalPace={270}
                  currentVdot={fitnessData.length > 0 ? Number(fitnessData[fitnessData.length - 1]?.vo2max || 50) : 50}
                  goalVdot={52}
                />
              )}
            </div>
            <div className="md:col-span-2">
              <ExpandableChartCard
                title="Fitness Trajectory"
                subtitle="VO2max + Decoupling"
                icon={<TrendingUp className="h-4 w-4" style={{ color: "oklch(60% 0.2 300)" }} />}
              >
                <FitnessTrajectoryChart data={fitnessData as any} />
              </ExpandableChartCard>
            </div>
          </div>

          {/* Trajectory Chart (Optimal vs Actual) */}
          {raceInfo && trajectoryData.length > 0 && (
            <ExpandableChartCard
              title="Training Trajectory"
              subtitle="Optimal vs Actual"
              icon={<Target className="h-4 w-4" style={{ color: "oklch(60% 0.2 300)" }} />}
              className="mb-6"
            >
              <TrajectoryChart
                data={trajectoryData as any}
                raceDate={raceInfo.race_date}
                today={today}
                goalVdot={52}
              />
            </ExpandableChartCard>
          )}

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
