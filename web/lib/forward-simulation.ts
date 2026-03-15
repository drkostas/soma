/**
 * Client-side forward simulation engine.
 *
 * Takes server-seeded state and projects every future workout's
 * adapted pace, distance, and HR zones through the merge formula.
 *
 * Design doc: docs/plans/2026-03-08-adaptive-engine-design.md §1
 */

import {
  readinessFactorCalc,
  fatigueFactorCalc,
  DEFAULT_BASE_PACE,
} from "./training-engine";
import { getBasePace, getHRZone } from "./vdot-pace-zones";
import { projectVdotSeries, DEFAULT_BANISTER, type BanisterParams, type DailyLoad } from "./banister-projection";
import { estimateHMSeconds } from "./vdot-utils";

// ── Types ────────────────────────────────────────────────────

export interface ComparisonData {
  load: { date: string; dailyLoad: number; ctl: number; atl: number }[];
  readiness: { date: string; garminScore: number; ourScore: number }[];
  fitness: { date: string; garminVo2max: number; ourVdot: number | null }[];
  racePrediction: { date: string; garminSeconds: number | null; ourVdot: number | null }[];
}

export interface SimulationSeeds {
  pmc: { ctl: number; atl: number; tsb: number };
  banister: { p0: number; k1: number; k2: number; tau1: number; tau2: number; nAnchors: number };
  readiness: { compositeZ: number; trafficLight: string };
  fitness: { vdotAdjusted: number; weightKg: number; calibrationWeightKg: number };
  planDays: PlanDay[];
  sliderMultiplier: number;
  comparison?: ComparisonData;
  epocScaleFactor?: number; // scale plan loads (distance×intensity) to EPOC units
}

export interface PlanDay {
  id: number;
  dayDate: string;
  runType: string;
  runTitle: string;
  targetDistanceKm: number;
  workoutSteps: any;
  loadLevel: string;
  gymWorkout: string | null;
  completed: boolean;
}

export interface ProjectedDay {
  dayDate: string;
  dayId: number;
  runType: string;

  // PMC state
  ctl: number;
  atl: number;
  tsb: number;

  // Readiness
  projectedZ: number;

  // Merge factors
  readinessFactor: number;
  fatigueFactor: number;
  weightFactor: number;
  combinedFactor: number;

  // Adapted targets
  originalPace: number;
  adjustedPace: number | null; // null = REST signal
  originalDistanceKm: number;
  adjustedDistanceKm: number;

  // Projected fitness
  projectedVdot: number;

  // Model output: predicted HM pace (base HM pace × merge factors)
  predictedHmPace: number | null; // sec/km, null for rest days

  // Adaptation delta
  paceChangePct: number;
  distanceChangePct: number;

  // Estimated load for this day
  estimatedLoad: number;

  // VDOT-zone fields
  basePaceForType: number;       // base pace from VDOT zone for this run type
  hrZone: { low: number; high: number; zone: string } | null;
  trafficLight: "green" | "yellow" | "red";
  effectiveRunType: string;      // may be downgraded by yellow/red

  // Flags
  isRest: boolean;
  hasSequencingConflict: boolean;
}

// ── Intensity multipliers by run type ────────────────────────

const INTENSITY_MULTIPLIER: Record<string, number> = {
  easy: 0.6,
  recovery: 0.5,
  tempo: 1.0,
  threshold: 1.0,
  intervals: 1.2,
  long: 0.8,
  race: 1.3,
  strides: 0.7,
  rest: 0,
};

// ── Hard run types for sequencing ────────────────────────────

const HARD_RUN_TYPES = new Set(["tempo", "intervals", "threshold", "race"]);
const LEG_WORKOUTS = new Set(["legs", "lower"]);

// ── Traffic light rest decisions ─────────────────────────────

function getTrafficLight(z: number): "green" | "yellow" | "red" {
  if (z > -0.5) return "green";
  if (z > -1.5) return "yellow";
  return "red";
}

function downgradeRunType(runType: string, light: "yellow" | "red"): string {
  if (light === "red") return "rest";
  // yellow: downgrade hard sessions to easy
  if (["tempo", "threshold", "intervals", "race"].includes(runType)) return "easy";
  return runType;
}

// ── Forward simulation ──────────────────────────────────────

export function runForwardSimulation(seeds: SimulationSeeds): ProjectedDay[] {
  const { pmc, banister, readiness, fitness, planDays, sliderMultiplier } = seeds;
  const epocScale = seeds.epocScaleFactor ?? 1;

  const tau1 = banister.tau1;
  const tau2 = banister.tau2;
  const alphaCtl = 1 - Math.exp(-1 / tau1);
  const alphaAtl = 1 - Math.exp(-1 / tau2);

  const weightFactor = fitness.calibrationWeightKg > 0
    ? fitness.weightKg / fitness.calibrationWeightKg
    : 1.0;

  let ctl = pmc.ctl;
  let atl = pmc.atl;
  let projectedZ = readiness.compositeZ;

  const today = new Date().toISOString().slice(0, 10);
  const results: ProjectedDay[] = [];

  // Track recent gym days for sequencing
  const recentGymDates: string[] = [];

  // Banister projection: use fitted p0 (historical baseline) with calibrated warm-start
  // so accumulated loads reproduce currentVdot at plan start, then plan loads add
  // realistic incremental improvement (dips after hard days, recovery on rest, taper peak).
  const k1 = seeds.banister?.k1 ?? DEFAULT_BANISTER.k1;
  const k2 = seeds.banister?.k2 ?? DEFAULT_BANISTER.k2;
  const currentVdot = seeds.fitness?.vdotAdjusted ?? DEFAULT_BANISTER.p0;
  const fittedP0 = seeds.banister?.p0 ?? DEFAULT_BANISTER.p0;

  const banisterParams: BanisterParams = {
    p0: fittedP0,
    k1,
    k2,
    tau1: seeds.banister?.tau1 ?? DEFAULT_BANISTER.tau1,
    tau2: seeds.banister?.tau2 ?? DEFAULT_BANISTER.tau2,
  };

  // Calibrate warm-start: find load level that makes Banister output ≈ currentVdot at plan start.
  // Solve: currentVdot = p0 + warmLoad * (k1·Σexp(-dt/τ1) - k2·Σexp(-dt/τ2))
  const WARMUP_DAYS = 60;
  let fitnessDecaySum = 0;
  let fatigueDecaySum = 0;
  for (let dt = 1; dt <= WARMUP_DAYS; dt++) {
    fitnessDecaySum += Math.exp(-dt / tau1);
    fatigueDecaySum += Math.exp(-dt / tau2);
  }
  const vdotGap = currentVdot - fittedP0;
  const denominator = k1 * fitnessDecaySum - k2 * fatigueDecaySum;
  const warmStartLoad = denominator > 0.001 ? vdotGap / denominator : 0;

  // Build warm-start loads
  const warmStartLoads: DailyLoad[] = [];
  if (planDays.length > 0 && warmStartLoad > 0) {
    const startMs = new Date(planDays[0].dayDate + "T00:00:00").getTime();
    for (let i = WARMUP_DAYS; i >= 1; i--) {
      warmStartLoads.push({
        date: new Date(startMs - i * 86400000).toISOString().split("T")[0],
        load: warmStartLoad,
      });
    }
  }

  // First pass: estimate EPOC-scaled loads for Banister (run only — gym doesn't affect VDOT)
  const planLoads: DailyLoad[] = planDays.map(day => ({
    date: day.dayDate,
    load: estimateDayLoad(day, sliderMultiplier).runLoad * epocScale,
  }));
  const dailyLoads: DailyLoad[] = [...warmStartLoads, ...planLoads];

  // Project VDOT for every day using full Banister model
  const allVdots = projectVdotSeries(dailyLoads, banisterParams);
  const vdotSeries = allVdots.slice(warmStartLoads.length);

  for (let dayIndex = 0; dayIndex < planDays.length; dayIndex++) {
    const day = planDays[dayIndex];
    const isRest = day.runType === "rest";
    const isCompleted = day.completed;
    const isFuture = day.dayDate >= today;

    // Sequencing conflict detection
    const hasSequencingConflict = checkSequencingConflict(
      day.dayDate, day.runType, recentGymDates,
    );

    // Track gym days
    if (day.gymWorkout && LEG_WORKOUTS.has(day.gymWorkout.toLowerCase())) {
      recentGymDates.push(day.dayDate);
      if (recentGymDates.length > 5) recentGymDates.shift();
    }

    if (!isFuture || isCompleted) {
      // Past/completed days: use actual data, just propagate PMC
      const { runLoad, gymLoad } = estimateDayLoad(day, sliderMultiplier);
      const epocLoad = runLoad * epocScale + gymLoad; // run load scaled to EPOC, gym already in EPOC
      const totalLoad = runLoad + gymLoad;
      ctl = epocLoad * alphaCtl + ctl * (1 - alphaCtl);
      atl = epocLoad * alphaAtl + atl * (1 - alphaAtl);

      // Use per-day Banister VDOT (varies over time) instead of static current VDOT
      const pastVdot = vdotSeries[dayIndex] ?? fitness.vdotAdjusted;
      const pastBasePace = getBasePace(pastVdot, day.runType);
      const pastHmBase = isRest ? null : Math.round(estimateHMSeconds(pastVdot) / 21.0975);

      results.push({
        dayDate: day.dayDate,
        dayId: day.id,
        runType: day.runType,
        ctl, atl, tsb: ctl - atl,
        projectedZ,
        readinessFactor: 1.0,
        fatigueFactor: 1.0,
        weightFactor,
        combinedFactor: 1.0,
        originalPace: pastBasePace,
        adjustedPace: pastBasePace,
        originalDistanceKm: day.targetDistanceKm,
        adjustedDistanceKm: day.targetDistanceKm,
        projectedVdot: pastVdot,
        predictedHmPace: pastHmBase,
        paceChangePct: 0,
        distanceChangePct: 0,
        estimatedLoad: totalLoad,
        basePaceForType: pastBasePace,
        hrZone: day.runType === "rest" ? null : getHRZone(day.runType),
        trafficLight: "green",
        effectiveRunType: day.runType,
        isRest,
        hasSequencingConflict: false,
      });
      continue;
    }

    // ── Future day: full projection ──

    // 1. Estimate training load (run load in raw units, gym load in EPOC units)
    const { runLoad, gymLoad } = estimateDayLoad(day, sliderMultiplier);
    const epocLoad = runLoad * epocScale + gymLoad; // run scaled to EPOC, gym already EPOC
    const totalLoad = runLoad + gymLoad;

    // 2. Propagate PMC with personal tau (using EPOC-scale loads to match actual CTL/ATL)
    ctl = epocLoad * alphaCtl + ctl * (1 - alphaCtl);
    atl = epocLoad * alphaAtl + atl * (1 - alphaAtl);
    const tsb = ctl - atl;

    // 3. Project readiness (load-reactive model, using EPOC-scale loads)
    if (isRest) {
      projectedZ = projectedZ + (0 - projectedZ) * 0.4;
    } else {
      const intensity = INTENSITY_MULTIPLIER[day.runType] ?? 0.6;
      if (intensity >= 0.9) {
        // Hard session: z drops (denominator calibrated for EPOC-scale ~200)
        projectedZ -= Math.min(epocLoad / 200, 1.0);
      } else {
        // Easy day: z recovers 0.2/day toward 0
        projectedZ = projectedZ + (0 - projectedZ) * 0.2;
      }
    }

    // Sequencing penalty
    if (hasSequencingConflict) {
      projectedZ -= 0.3;
    }

    // 4. Apply merge formula
    const rf = readinessFactorCalc(projectedZ);
    const ff = fatigueFactorCalc(tsb);

    // Traffic light decision
    const light = getTrafficLight(projectedZ);
    const effectiveRunType = light === "green" ? day.runType :
      downgradeRunType(day.runType, light);

    // Get VDOT-based pace for this specific workout type
    const dayVdot = vdotSeries[dayIndex] ?? fitness.vdotAdjusted;
    const basePaceForType = getBasePace(dayVdot, effectiveRunType);
    const hrZone = effectiveRunType === "rest" ? null : getHRZone(effectiveRunType);

    let combinedFactor: number;
    let adjustedPace: number | null;
    let adjustedDistanceKm: number;
    let predictedHmPace: number | null;

    if (rf < 0) {
      // REST signal (z <= -2.0)
      combinedFactor = 1.0;
      adjustedPace = null;
      adjustedDistanceKm = 0;
      predictedHmPace = null;
    } else {
      combinedFactor = rf * ff * weightFactor;
      const delta = combinedFactor - 1.0;
      const sliderAdjusted = 1.0 + delta * sliderMultiplier;

      // Apply merge formula to the type-specific base pace
      adjustedPace = Math.round(basePaceForType * sliderAdjusted);

      // Distance: preserve training load (load ≈ distance × intensity)
      adjustedDistanceKm = Math.round(
        day.targetDistanceKm * (2.0 - combinedFactor) * 10,
      ) / 10;

      // Predicted HM pace: base HM pace from VDOT × merge factors
      const dayVdot = vdotSeries[dayIndex] ?? fitness.vdotAdjusted;
      const baseHmPace = estimateHMSeconds(dayVdot) / 21.0975;
      predictedHmPace = Math.round(baseHmPace * sliderAdjusted);
    }

    // 5. Project VDOT via Banister model
    const projectedVdot = vdotSeries[dayIndex] ?? fitness.vdotAdjusted;

    // Compute deltas
    const paceChangePct = adjustedPace != null
      ? Math.round(((adjustedPace - basePaceForType) / basePaceForType) * 1000) / 10
      : 0;
    const distanceChangePct = day.targetDistanceKm > 0
      ? Math.round(((adjustedDistanceKm - day.targetDistanceKm) / day.targetDistanceKm) * 1000) / 10
      : 0;

    results.push({
      dayDate: day.dayDate,
      dayId: day.id,
      runType: day.runType,
      ctl, atl, tsb,
      projectedZ,
      readinessFactor: rf < 0 ? -1 : Math.round(rf * 10000) / 10000,
      fatigueFactor: Math.round(ff * 10000) / 10000,
      weightFactor: Math.round(weightFactor * 10000) / 10000,
      combinedFactor: Math.round(combinedFactor * 10000) / 10000,
      originalPace: basePaceForType,
      adjustedPace: adjustedPace != null ? Math.round(adjustedPace * 10) / 10 : null,
      originalDistanceKm: day.targetDistanceKm,
      adjustedDistanceKm,
      projectedVdot,
      predictedHmPace,
      paceChangePct,
      distanceChangePct,
      estimatedLoad: totalLoad,
      basePaceForType,
      hrZone,
      trafficLight: light,
      effectiveRunType,
      isRest: isRest || rf < 0,
      hasSequencingConflict,
    });
  }

  return results;
}

// ── Helpers ──────────────────────────────────────────────────

/** Estimate day's training load in raw units (distance × intensity).
 *  Gym load is returned separately since it's already in EPOC-like units
 *  and must NOT be multiplied by the EPOC scale factor.
 */
function estimateDayLoad(day: PlanDay, sliderMultiplier: number): { runLoad: number; gymLoad: number } {
  if (day.runType === "rest") return { runLoad: 0, gymLoad: 0 };

  const intensity = INTENSITY_MULTIPLIER[day.runType] ?? 0.6;
  const runLoad = day.targetDistanceKm * intensity * sliderMultiplier;

  // Gym load in EPOC units directly (~60 EPOC for a typical strength session)
  const gymLoad = day.gymWorkout ? 60 : 0;

  return { runLoad, gymLoad };
}

function checkSequencingConflict(
  dayDate: string,
  runType: string,
  recentGymDates: string[],
): boolean {
  if (!HARD_RUN_TYPES.has(runType)) return false;

  const dayMs = new Date(dayDate + "T00:00:00").getTime();

  for (const gymDate of recentGymDates) {
    const gymMs = new Date(gymDate + "T00:00:00").getTime();
    const daysDiff = (dayMs - gymMs) / 86400000;
    if (daysDiff > 0 && daysDiff <= 2) return true;
  }

  return false;
}
