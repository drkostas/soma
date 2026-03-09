import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { RaceCountdown } from "@/components/race-countdown";
import { RaceSplitsCard } from "@/components/race-splits-card";
import { TrainingDashboard } from "@/components/training-dashboard";
import { getDb } from "@/lib/db";
import { Target, AlertTriangle } from "lucide-react";
import { TrainingControls } from "@/components/training-controls";

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
    SELECT r.composite_score, r.traffic_light,
           h.training_readiness_score AS garmin_readiness_score,
           h.training_readiness_level AS garmin_readiness_level
    FROM daily_readiness r
    LEFT JOIN daily_health_summary h ON r.date = h.date
    ORDER BY r.date DESC
    LIMIT 1
  `;
  return rows[0] || null;
}

async function getPMCLatest() {
  const sql = getDb();
  const rows = await sql`
    SELECT tsb FROM pmc_daily ORDER BY date DESC LIMIT 1
  `;
  return rows[0] || null;
}

async function getFitnessLatest() {
  const sql = getDb();
  const rows = await sql`
    SELECT vo2max FROM fitness_trajectory
    WHERE vo2max IS NOT NULL
    ORDER BY date DESC LIMIT 1
  `;
  return rows[0] || null;
}

async function getReferenceData() {
  const sql = getDb();
  const [readinessHistory, fitnessHistory, weightHistory] = await Promise.all([
    sql`SELECT r.date::text as date, r.composite_score,
           h.training_readiness_score AS garmin_readiness_score
       FROM daily_readiness r
       LEFT JOIN daily_health_summary h ON r.date = h.date
       WHERE r.date >= CURRENT_DATE - interval '14 days'
       ORDER BY r.date`,
    sql`SELECT date::text as date, efficiency_factor, decoupling_pct,
           race_prediction_seconds, vdot_adjusted
       FROM fitness_trajectory
       WHERE date >= CURRENT_DATE - interval '30 days'
       ORDER BY date`,
    sql`SELECT date::text as date, weight_kg
       FROM fitness_trajectory
       WHERE weight_kg IS NOT NULL
       AND date >= CURRENT_DATE - interval '14 days'
       ORDER BY date`,
  ]);
  return { readinessHistory, fitnessHistory, weightHistory };
}

async function getTrajectoryData(raceDate: string) {
  const sql = getDb();

  // Fetch actual VDOT, weight, plus CTL and readiness in parallel
  const [actuals, pmcRows, readinessRows] = await Promise.all([
    sql`
      SELECT date::text as date, vo2max, weight_kg
      FROM fitness_trajectory
      WHERE vo2max IS NOT NULL
      ORDER BY date
    `,
    sql`
      SELECT date::text as date, ctl
      FROM pmc_daily
      ORDER BY date
    `,
    sql`
      SELECT date::text as date, composite_score
      FROM daily_readiness
      ORDER BY date
    `,
  ]);

  if (actuals.length === 0) return [];

  // Query rest days from the active plan to filter them from the X-axis
  const restDays = await sql`
    SELECT day_date::text as day_date FROM training_plan_day
    WHERE plan_id = (SELECT id FROM training_plan WHERE status = 'active' LIMIT 1)
      AND run_type = 'rest'
  `;
  const restDatesSet = new Set(restDays.map((r: any) => r.day_date));

  const currentVo2 = Number(actuals[actuals.length - 1].vo2max);
  const goalVo2 = 52; // VDOT needed for A-goal (1:35)

  const start = new Date(actuals[0].date + "T00:00:00");
  const end = new Date(raceDate + "T00:00:00");
  const totalDays = Math.max(1, (end.getTime() - start.getTime()) / 86400000);

  const actualMap = new Map(actuals.map((a: any) => [a.date, Number(a.vo2max)]));
  const weightMap = new Map(actuals.filter((a: any) => a.weight_kg != null).map((a: any) => [a.date, Number(a.weight_kg)]));
  const ctlMap = new Map(pmcRows.map((r: any) => [r.date, Number(r.ctl)]));
  const readinessMap = new Map(readinessRows.map((r: any) => [r.date, Number(r.composite_score)]));

  // Compute normalization ranges for secondary dimensions
  const ctlValues = pmcRows.map((r: any) => Number(r.ctl)).filter((v: number) => !isNaN(v));
  const ctlMin = ctlValues.length > 0 ? Math.min(...ctlValues) : 0;
  const ctlMax = ctlValues.length > 0 ? Math.max(...ctlValues) : 1;
  const ctlRange = Math.max(ctlMax - ctlMin, 1);

  const readinessValues = readinessRows.map((r: any) => Number(r.composite_score)).filter((v: number) => !isNaN(v));
  const readinessMin = readinessValues.length > 0 ? Math.min(...readinessValues) : 0;
  const readinessMax = readinessValues.length > 0 ? Math.max(...readinessValues) : 1;
  const readinessRange = Math.max(readinessMax - readinessMin, 1);

  const weightValues = [...weightMap.values()].filter((v) => !isNaN(v));
  const weightMin = weightValues.length > 0 ? Math.min(...weightValues) : 70;
  const weightMax = weightValues.length > 0 ? Math.max(...weightValues) : 80;
  const weightRange = Math.max(weightMax - weightMin, 1);

  type TrajectoryPoint = {
    date: string;
    optimal: number;
    actual: number | null;
    ctl: number | null;
    readiness: number | null;
    weightEffect: number | null;
  };

  const trajectory: TrajectoryPoint[] = [];
  const current = new Date(start);
  while (current <= end) {
    const dateStr = current.toISOString().split("T")[0];

    // Skip rest days (but always include if there's actual data for that day)
    if (restDatesSet.has(dateStr) && !actualMap.has(dateStr)) {
      current.setDate(current.getDate() + 1);
      continue;
    }

    const dayNum = (current.getTime() - start.getTime()) / 86400000;
    // Logistic S-curve: fast early gains, plateau, slight taper supercompensation
    const progress = dayNum / totalDays;
    // S-curve: sigmoid with steeper early phase
    const sCurve = 1 / (1 + Math.exp(-8 * (progress - 0.4)));
    // Taper bump: small supercompensation in last 15% of plan
    const taperBump = progress > 0.85 ? 0.3 * Math.sin((progress - 0.85) / 0.15 * Math.PI) : 0;
    const optimal = currentVo2 + (goalVo2 - currentVo2) * (sCurve + taperBump * 0.1);

    // Normalize secondary dimensions to 0-1
    const rawCtl = ctlMap.get(dateStr);
    const rawReadiness = readinessMap.get(dateStr);
    const rawWeight = weightMap.get(dateStr);

    trajectory.push({
      date: dateStr,
      optimal,
      actual: actualMap.get(dateStr) ?? null,
      ctl: rawCtl != null ? (rawCtl - ctlMin) / ctlRange : null,
      readiness: rawReadiness != null ? (rawReadiness - readinessMin) / readinessRange : null,
      // Weight effect: inverted — lighter is better (higher value)
      weightEffect: rawWeight != null ? 1 - (rawWeight - weightMin) / weightRange : null,
    });
    current.setDate(current.getDate() + 1);
  }

  return trajectory;
}

export default async function TrainingPage() {
  const [planDays, raceInfo, readiness, pmcLatest, fitnessLatest, referenceData] = await Promise.all([
    getTrainingPlan(),
    getRaceInfo(),
    getReadiness(),
    getPMCLatest(),
    getFitnessLatest(),
    getReferenceData(),
  ]);

  const today = new Date().toISOString().split("T")[0];

  // Trajectory data (depends on raceInfo)
  const trajectoryData = raceInfo ? await getTrajectoryData(raceInfo.race_date) : [];

  // Compute stats for header + race countdown
  const totalWeeks = planDays.length > 0
    ? Math.max(...planDays.map((d: any) => d.week_number))
    : 0;

  const todayEntry = planDays.find((d: any) => d.day_date === today);
  const currentWeek = todayEntry?.week_number ?? 1;
  const completedDays = planDays.filter((d: any) => d.completed).length;
  const totalDays = planDays.length;

  const currentVdot = fitnessLatest ? Number(fitnessLatest.vo2max || 50) : 50;

  // Compute today's plan adaptation (needs readiness + PMC data)
  let todayAdaptation: { action: string; adjustedType: string; adjustedKm: number; paceFactor: number; reason: string } | null = null;
  if (todayEntry && readiness && pmcLatest) {
    const tl = readiness.traffic_light || "green";
    const tsb = Number(pmcLatest.tsb || 0);
    const isHard = ["tempo", "intervals", "threshold"].includes(todayEntry.run_type);
    const isRest = todayEntry.run_type === "rest";

    if (isRest) {
      todayAdaptation = { action: "as_planned", adjustedType: "rest", adjustedKm: 0, paceFactor: 1.0, reason: "Rest day" };
    } else if (tl === "red" && isHard) {
      todayAdaptation = { action: "downgrade_to_rest", adjustedType: "easy", adjustedKm: 4.0, paceFactor: 1.10, reason: "RED readiness" };
    } else if (tl === "red") {
      todayAdaptation = { action: "reduce", adjustedType: todayEntry.run_type, adjustedKm: Math.min(todayEntry.target_distance_km, 4.0), paceFactor: 1.10, reason: "RED readiness" };
    } else if (tl === "yellow" && isHard) {
      todayAdaptation = { action: "swap_to_easy", adjustedType: "easy", adjustedKm: Math.round(todayEntry.target_distance_km * 0.85 * 10) / 10, paceFactor: 1.05, reason: "YELLOW readiness" };
    } else if (tl === "yellow") {
      todayAdaptation = { action: "as_planned", adjustedType: todayEntry.run_type, adjustedKm: todayEntry.target_distance_km, paceFactor: 1.0, reason: "YELLOW readiness — easy run OK" };
    } else if (tsb < -20) {
      todayAdaptation = { action: "reduce", adjustedType: todayEntry.run_type, adjustedKm: Math.round(todayEntry.target_distance_km * 0.85 * 10) / 10, paceFactor: 1.03, reason: `Accumulated fatigue (TSB ${tsb.toFixed(0)})` };
    } else if (tsb < -15) {
      todayAdaptation = { action: "reduce", adjustedType: todayEntry.run_type, adjustedKm: Math.round(todayEntry.target_distance_km * 0.90 * 10) / 10, paceFactor: 1.02, reason: `Moderate fatigue (TSB ${tsb.toFixed(0)})` };
    } else {
      todayAdaptation = { action: "as_planned", adjustedType: todayEntry.run_type, adjustedKm: todayEntry.target_distance_km, paceFactor: 1.0, reason: "All signals green" };
    }
  }

  const hasNoPlan = planDays.length === 0;

  // Days until race for the thin header bar
  const daysUntilRace = raceInfo
    ? Math.max(0, Math.ceil((new Date(raceInfo.race_date + "T00:00:00").getTime() - Date.now()) / 86400000))
    : 0;

  return (
    <div className="container mx-auto px-3 sm:px-6 py-4 sm:py-8 max-w-7xl">
      {/* Page header — thin bar with race context */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Training</h1>
          <p className="text-sm text-muted-foreground">
            {hasNoPlan
              ? "No active training plan."
              : `${raceInfo?.plan_name || "Training Plan"} · ${daysUntilRace}d to race · Week ${currentWeek}/${totalWeeks}`}
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
        <div className="space-y-6">
          {/* Hoisted adaptation alert — visible above the graph */}
          {todayAdaptation && todayAdaptation.action !== "as_planned" && (
            <div className="flex items-center gap-2 rounded-md border border-yellow-500/50 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-200">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                Today&apos;s plan adjusted: {todayAdaptation.reason} &mdash;{" "}
                {todayAdaptation.adjustedType} {todayAdaptation.adjustedKm.toFixed(1)} km
              </span>
            </div>
          )}

          {/* Training Dashboard — client component managing graph, trajectory, and plan */}
          <TrainingDashboard
            planDays={planDays as any}
            today={today}
            raceInfo={raceInfo as any}
            trajectoryData={trajectoryData}
            currentVdot={currentVdot}
            goalVdot={52}
            todayAdaptation={todayAdaptation}
            referenceData={referenceData as any}
          />

          {/* Race Countdown + Splits (moved below main dashboard) */}
          {raceInfo && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
        </div>
      )}
    </div>
  );
}
