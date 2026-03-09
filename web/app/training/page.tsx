import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { TrainingDashboard } from "@/components/training-dashboard";
import { getDb } from "@/lib/db";
import { Target } from "lucide-react";
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
    projectedVdot: number | null;
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
      projectedVdot: null, // filled in below
      ctl: rawCtl != null ? (rawCtl - ctlMin) / ctlRange : null,
      readiness: rawReadiness != null ? (rawReadiness - readinessMin) / readinessRange : null,
      // Weight effect: inverted — lighter is better (higher value)
      weightEffect: rawWeight != null ? 1 - (rawWeight - weightMin) / weightRange : null,
    });
    current.setDate(current.getDate() + 1);
  }

  // ── Future projection: linear regression on last 7 actual VDOT points ──
  const actualPoints = trajectory
    .filter((t) => t.actual !== null)
    .map((t) => ({ date: t.date, vdot: t.actual as number }));

  if (actualPoints.length >= 2) {
    // Take the last 7 (or fewer) actual data points for regression
    const recentPoints = actualPoints.slice(-7);
    const lastActualDate = recentPoints[recentPoints.length - 1].date;
    const lastActualMs = new Date(lastActualDate + "T00:00:00").getTime();

    // Convert dates to day offsets from the first recent point
    const baseMs = new Date(recentPoints[0].date + "T00:00:00").getTime();
    const xs = recentPoints.map((p) => (new Date(p.date + "T00:00:00").getTime() - baseMs) / 86400000);
    const ys = recentPoints.map((p) => p.vdot);

    // Linear regression: slope = sum((xi - x_mean)(yi - y_mean)) / sum((xi - x_mean)^2)
    const n = xs.length;
    const xMean = xs.reduce((a, b) => a + b, 0) / n;
    const yMean = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      num += (xs[i] - xMean) * (ys[i] - yMean);
      den += (xs[i] - xMean) * (xs[i] - xMean);
    }
    const slope = den !== 0 ? num / den : 0;
    const lastActualVdot = recentPoints[recentPoints.length - 1].vdot;

    // Fill projectedVdot for dates AFTER the last actual data point
    // Also set projectedVdot on the last actual point itself so the line connects
    for (const point of trajectory) {
      const pointMs = new Date(point.date + "T00:00:00").getTime();
      if (pointMs === lastActualMs) {
        // Anchor: start the projection line at the last actual value
        point.projectedVdot = lastActualVdot;
      } else if (pointMs > lastActualMs) {
        const daysSinceLast = (pointMs - lastActualMs) / 86400000;
        point.projectedVdot = Number((lastActualVdot + slope * daysSinceLast).toFixed(2));
      }
    }
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

  const currentVdot = fitnessLatest ? Number(fitnessLatest.vo2max || 50) : 50;

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
          {/* Training Dashboard — client component managing graph, trajectory, and plan */}
          <TrainingDashboard
            planDays={planDays as any}
            today={today}
            raceInfo={raceInfo as any}
            trajectoryData={trajectoryData}
            currentVdot={currentVdot}
            goalVdot={52}
            referenceData={referenceData as any}
          />
        </div>
      )}
    </div>
  );
}
