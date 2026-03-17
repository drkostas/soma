import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { TrainingDashboard } from "@/components/training-dashboard";
import { getDb } from "@/lib/db";
import { Target } from "lucide-react";
import { TrainingControls } from "@/components/training-controls";
import { projectVdotSeries, DEFAULT_BANISTER, type DailyLoad } from "@/lib/banister-projection";
import { vdotFromHmSeconds } from "@/lib/vdot-utils";

export const metadata: Metadata = { title: "Training" };
export const revalidate = 300;

/** Safe query wrapper — returns fallback on missing table or other DB error. */
async function safeQuery<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

async function getTrainingPlan() {
  const sql = getDb();
  return safeQuery(
    () => sql`
      SELECT d.*, d.day_date::text as day_date,
             p.plan_name, p.race_date::text as race_date, p.goal_time_seconds
      FROM training_plan_day d
      JOIN training_plan p ON d.plan_id = p.id
      WHERE p.status = 'active'
      ORDER BY d.day_date
    `,
    [],
  );
}

async function getRaceInfo() {
  const sql = getDb();
  const rows = await safeQuery(
    () => sql`
      SELECT race_date::text as race_date, goal_time_seconds, plan_name
      FROM training_plan
      WHERE status = 'active'
      LIMIT 1
    `,
    [],
  );
  return rows[0] || null;
}

async function getReadiness() {
  const sql = getDb();
  const rows = await safeQuery(
    () => sql`
      SELECT r.composite_score, r.traffic_light,
             h.training_readiness_score AS garmin_readiness_score,
             h.training_readiness_level AS garmin_readiness_level
      FROM daily_readiness r
      LEFT JOIN daily_health_summary h ON r.date = h.date
      ORDER BY r.date DESC
      LIMIT 1
    `,
    [],
  );
  return rows[0] || null;
}

async function getPMCLatest() {
  const sql = getDb();
  const rows = await safeQuery(
    () => sql`
      SELECT tsb FROM pmc_daily ORDER BY date DESC LIMIT 1
    `,
    [],
  );
  return rows[0] || null;
}

async function getFitnessLatest() {
  const sql = getDb();
  const rows = await safeQuery(
    () => sql`
      SELECT vo2max FROM fitness_trajectory
      WHERE vo2max IS NOT NULL
      ORDER BY date DESC LIMIT 1
    `,
    [],
  );
  return rows[0] || null;
}

async function getReferenceData() {
  const sql = getDb();
  const [readinessHistory, fitnessHistory, weightHistory] = await Promise.all([
    safeQuery(
      () => sql`SELECT r.date::text as date, r.composite_score,
             h.training_readiness_score AS garmin_readiness_score
         FROM daily_readiness r
         LEFT JOIN daily_health_summary h ON r.date = h.date
         WHERE r.date >= CURRENT_DATE - interval '14 days'
         ORDER BY r.date`,
      [],
    ),
    safeQuery(
      () => sql`SELECT date::text as date, efficiency_factor, decoupling_pct,
             race_prediction_seconds, vdot_adjusted
         FROM fitness_trajectory
         WHERE date >= CURRENT_DATE - interval '30 days'
         ORDER BY date`,
      [],
    ),
    safeQuery(
      () => sql`SELECT date::text as date, weight_kg
         FROM fitness_trajectory
         WHERE weight_kg IS NOT NULL
         AND date >= CURRENT_DATE - interval '14 days'
         ORDER BY date`,
      [],
    ),
  ]);
  return { readinessHistory, fitnessHistory, weightHistory };
}

async function getBanisterParams() {
  const sql = getDb();
  const rows = await safeQuery(
    () => sql`
      SELECT p0, k1, k2, tau1, tau2, current_vdot
      FROM banister_params ORDER BY fitted_at DESC LIMIT 1
    `,
    [],
  );
  return rows[0] || null;
}

async function getTrajectoryData(
  raceDate: string,
  banister: any | null,
  planDays: any[],
) {
  const sql = getDb();

  // Fetch actual VDOT, weight, plus CTL, daily loads, and readiness in parallel
  const [actuals, pmcRows, readinessRows] = await Promise.all([
    safeQuery(
      () => sql`
        SELECT date::text as date, vo2max, weight_kg
        FROM fitness_trajectory
        WHERE vo2max IS NOT NULL
        ORDER BY date
      `,
      [],
    ),
    safeQuery(
      () => sql`
        SELECT date::text as date, ctl, daily_load
        FROM pmc_daily
        ORDER BY date
      `,
      [],
    ),
    safeQuery(
      () => sql`
        SELECT date::text as date, composite_score
        FROM daily_readiness
        ORDER BY date
      `,
      [],
    ),
  ]);

  if (actuals.length === 0) return { trajectory: [], norms: { ctlMin: 0, ctlRange: 1, readinessMin: 0, readinessRange: 1, weightMin: 70, weightRange: 10 } };

  // Query rest days from the active plan to filter them from the X-axis
  const restDays = await safeQuery(
    () => sql`
      SELECT day_date::text as day_date FROM training_plan_day
      WHERE plan_id = (SELECT id FROM training_plan WHERE status = 'active' LIMIT 1)
        AND run_type = 'rest'
    `,
    [],
  );
  const restDatesSet = new Set(restDays.map((r: any) => r.day_date));

  // Race-calibrated VDOT from Banister model — no Garmin fallback
  const banisterCurrentVdot = banister?.current_vdot ? Number(banister.current_vdot) : 0;
  const currentVo2 = banisterCurrentVdot;

  const start = new Date(actuals[0].date + "T00:00:00");
  const end = new Date(raceDate + "T00:00:00");

  const actualMap = new Map(actuals.map((a: any) => [a.date, Number(a.vo2max)]));
  const weightMap = new Map(actuals.filter((a: any) => a.weight_kg != null).map((a: any) => [a.date, Number(a.weight_kg)]));
  const ctlMap = new Map(pmcRows.map((r: any) => [r.date, Number(r.ctl)]));
  const readinessMap = new Map(readinessRows.map((r: any) => [r.date, Number(r.composite_score)]));

  // ── Banister projection using full historical loads ──
  // Use the raw p0 (historical baseline) with real loads from pmc_daily.
  // This reproduces the Python model's VDOT curve for all dates.
  const rawP0 = banister ? Number(banister.p0) : 0;
  const hasRawP0 = rawP0 > 0;
  const banisterParams = banister ? {
    p0: hasRawP0 ? rawP0 : currentVo2,
    k1: Number(banister.k1) || DEFAULT_BANISTER.k1,
    k2: Number(banister.k2) || DEFAULT_BANISTER.k2,
    tau1: Number(banister.tau1) || DEFAULT_BANISTER.tau1,
    tau2: Number(banister.tau2) || DEFAULT_BANISTER.tau2,
  } : { ...DEFAULT_BANISTER, p0: currentVo2 };

  const INTENSITY: Record<string, number> = {
    easy: 0.6, recovery: 0.5, tempo: 1.0, threshold: 1.0,
    intervals: 1.2, long: 0.8, race: 1.3, rest: 0,
  };

  // Build historical loads from pmc_daily (real data, EPOC-based units)
  const historicalLoadMap = new Map<string, number>();
  for (const r of pmcRows) {
    const load = Number((r as any).daily_load) || 0;
    if (load > 0) historicalLoadMap.set(r.date as string, load);
  }

  // Compute scale factor: plan loads use distance×intensity (0-15 range)
  // but actual loads are EPOC-based (100-500+ range). Scale plan loads to match.
  const recentActualLoads = [...historicalLoadMap.values()].slice(-30).filter(v => v > 0);
  const avgActualLoad = recentActualLoads.length > 0
    ? recentActualLoads.reduce((s, v) => s + v, 0) / recentActualLoads.length
    : 0;

  // Compute raw plan load estimates and their average
  const rawPlanLoads: { date: string; load: number }[] = [];
  for (const d of planDays) {
    const raw = ((d as any).target_distance_km || 0) * (INTENSITY[(d as any).run_type] || 0.6);
    if (raw > 0) rawPlanLoads.push({ date: (d as any).day_date, load: raw });
  }
  const avgRawPlanLoad = rawPlanLoads.length > 0
    ? rawPlanLoads.reduce((s, v) => s + v.load, 0) / rawPlanLoads.length
    : 1;

  // Scale factor: match plan load units to actual EPOC units
  const loadScaleFactor = avgActualLoad > 0 ? avgActualLoad / avgRawPlanLoad : 1;

  // Add future plan loads scaled to EPOC units (for dates not yet in pmc_daily)
  const planLoadMap = new Map<string, number>();
  for (const d of planDays) {
    const raw = ((d as any).target_distance_km || 0) * (INTENSITY[(d as any).run_type] || 0.6);
    if (raw > 0) planLoadMap.set((d as any).day_date, raw * loadScaleFactor);
  }

  // Build one DailyLoad entry per day from (trajectory_start - lookback) to race date.
  // Lookback = 5 × max(tau1, tau2) to capture full model memory.
  const lookbackDays = Math.ceil(5 * Math.max(banisterParams.tau1, banisterParams.tau2));
  const trajectoryStartMs = start.getTime();
  const seriesStartMs = trajectoryStartMs - lookbackDays * 86400000;
  const endMs = end.getTime();

  const allLoads: DailyLoad[] = [];
  for (let ms = seriesStartMs; ms <= endMs; ms += 86400000) {
    const dateStr = new Date(ms).toISOString().split("T")[0];
    const load = historicalLoadMap.get(dateStr) ?? planLoadMap.get(dateStr) ?? 0;
    allLoads.push({ date: dateStr, load });
  }

  // Full Banister model: p0 + k1*fitness - k2*fatigue
  // Produces smooth curve (no zigzag) because loads take effect gradually
  const projectedVdots = projectVdotSeries(allLoads, banisterParams);

  const banisterVdotMap = new Map<string, number>();
  allLoads.forEach((l, i) => {
    if (l.date >= actuals[0].date) {
      banisterVdotMap.set(l.date, projectedVdots[i]);
    }
  });

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

  // Forward-fill: carry last known normalized values into future dates
  let lastCtlNorm: number | null = null;
  let lastReadinessNorm: number | null = null;
  let lastWeightNorm: number | null = null;

  while (current <= end) {
    const dateStr = current.toISOString().split("T")[0];

    // Include all days (including rest) for a continuous trajectory line
    const optimal = banisterVdotMap.get(dateStr) ?? currentVo2;

    // Normalize secondary dimensions with forward-fill
    const rawCtl = ctlMap.get(dateStr);
    const rawReadiness = readinessMap.get(dateStr);
    const rawWeight = weightMap.get(dateStr);

    const ctlNorm: number | null = rawCtl != null ? (rawCtl - ctlMin) / ctlRange : lastCtlNorm;
    const readinessNorm: number | null = rawReadiness != null ? (rawReadiness - readinessMin) / readinessRange : lastReadinessNorm;
    const weightNorm: number | null = rawWeight != null ? 1 - (rawWeight - weightMin) / weightRange : lastWeightNorm;

    if (ctlNorm != null) lastCtlNorm = ctlNorm;
    if (readinessNorm != null) lastReadinessNorm = readinessNorm;
    if (weightNorm != null) lastWeightNorm = weightNorm;

    trajectory.push({
      date: dateStr,
      optimal,
      actual: actualMap.get(dateStr) ?? null,
      projectedVdot: null, // filled in below
      ctl: ctlNorm,
      readiness: readinessNorm,
      weightEffect: weightNorm,
    });
    current.setDate(current.getDate() + 1);
  }

  // ── Future projection: Banister-based ──
  const actualPoints = trajectory
    .filter((t) => t.actual !== null)
    .map((t) => ({ date: t.date, vdot: t.actual as number }));

  const lastActualDate = actualPoints.length > 0
    ? actualPoints[actualPoints.length - 1].date : null;

  for (const point of trajectory) {
    point.projectedVdot = banisterVdotMap.get(point.date) ?? null;
  }

  return {
    trajectory,
    norms: { ctlMin, ctlRange, readinessMin, readinessRange, weightMin, weightRange },
  };
}

export default async function TrainingPage() {
  const [planDays, raceInfo, readiness, pmcLatest, fitnessLatest, referenceData, banisterParams] = await Promise.all([
    getTrainingPlan(),
    getRaceInfo(),
    getReadiness(),
    getPMCLatest(),
    getFitnessLatest(),
    getReferenceData(),
    getBanisterParams(),
  ]);

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

  // Trajectory data (depends on raceInfo, banister params, and plan days)
  let trajectoryData: { date: string; optimal: number; actual: number | null; projectedVdot: number | null; ctl: number | null; readiness: number | null; weightEffect: number | null }[] = [];
  let trajectoryNorms: { ctlMin: number; ctlRange: number; readinessMin: number; readinessRange: number; weightMin: number; weightRange: number } | null = null;
  if (raceInfo) {
    const result = await getTrajectoryData(raceInfo.race_date, banisterParams, planDays as any[]);
    trajectoryData = result.trajectory;
    trajectoryNorms = result.norms;
  }

  // Compute stats for header + race countdown
  const totalWeeks = planDays.length > 0
    ? Math.max(...planDays.map((d: any) => d.week_number))
    : 0;

  const todayEntry = planDays.find((d: any) => d.day_date === today);
  const currentWeek = todayEntry?.week_number ?? 1;

  // Race-calibrated VDOT from Banister model — no Garmin fallback
  const banisterVdot = banisterParams ? Number(banisterParams.current_vdot) : 0;
  const currentVdot = banisterVdot;

  // Compute goal VDOT from the plan's target HM time (or fallback to 49)
  const goalVdot = raceInfo?.goal_time_seconds
    ? vdotFromHmSeconds(Number(raceInfo.goal_time_seconds))
    : 49;

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
            trajectoryNorms={trajectoryNorms}
            currentVdot={currentVdot}
            goalVdot={goalVdot}
            referenceData={referenceData as any}
          />
        </div>
      )}
    </div>
  );
}
