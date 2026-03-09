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

  // Adaptation delta
  paceChangePct: number;
  distanceChangePct: number;

  // Estimated load for this day
  estimatedLoad: number;

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

// ── Forward simulation ──────────────────────────────────────

export function runForwardSimulation(seeds: SimulationSeeds): ProjectedDay[] {
  const { pmc, banister, readiness, fitness, planDays, sliderMultiplier } = seeds;

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

  for (const day of planDays) {
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
      const estimatedLoad = estimateDayLoad(day, sliderMultiplier);
      ctl = estimatedLoad * alphaCtl + ctl * (1 - alphaCtl);
      atl = estimatedLoad * alphaAtl + atl * (1 - alphaAtl);

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
        originalPace: DEFAULT_BASE_PACE,
        adjustedPace: DEFAULT_BASE_PACE,
        originalDistanceKm: day.targetDistanceKm,
        adjustedDistanceKm: day.targetDistanceKm,
        projectedVdot: fitness.vdotAdjusted,
        paceChangePct: 0,
        distanceChangePct: 0,
        estimatedLoad,
        isRest,
        hasSequencingConflict: false,
      });
      continue;
    }

    // ── Future day: full projection ──

    // 1. Estimate training load
    const estimatedLoad = estimateDayLoad(day, sliderMultiplier);

    // 2. Propagate PMC with personal tau
    ctl = estimatedLoad * alphaCtl + ctl * (1 - alphaCtl);
    atl = estimatedLoad * alphaAtl + atl * (1 - alphaAtl);
    const tsb = ctl - atl;

    // 3. Project readiness (load-reactive model)
    if (isRest) {
      projectedZ = projectedZ + (0 - projectedZ) * 0.4;
    } else {
      const intensity = INTENSITY_MULTIPLIER[day.runType] ?? 0.6;
      if (intensity >= 0.9) {
        // Hard session: z drops
        projectedZ -= Math.min(estimatedLoad / 200, 1.0);
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

    let combinedFactor: number;
    let adjustedPace: number | null;
    let adjustedDistanceKm: number;

    if (rf < 0) {
      // REST signal (z <= -2.0)
      combinedFactor = 1.0;
      adjustedPace = null;
      adjustedDistanceKm = 0;
    } else {
      combinedFactor = rf * ff * weightFactor;
      const delta = combinedFactor - 1.0;
      const sliderAdjusted = 1.0 + delta * sliderMultiplier;
      adjustedPace = DEFAULT_BASE_PACE * sliderAdjusted;

      // Distance: preserve training load (load ≈ distance × intensity)
      adjustedDistanceKm = Math.round(
        day.targetDistanceKm * (2.0 - combinedFactor) * 10,
      ) / 10;
    }

    // 5. Predict VDOT (simplified — full Banister prediction needs cumulative loads)
    const projectedVdot = fitness.vdotAdjusted;

    // Compute deltas
    const paceChangePct = adjustedPace != null
      ? Math.round(((adjustedPace - DEFAULT_BASE_PACE) / DEFAULT_BASE_PACE) * 1000) / 10
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
      originalPace: DEFAULT_BASE_PACE,
      adjustedPace: adjustedPace != null ? Math.round(adjustedPace * 10) / 10 : null,
      originalDistanceKm: day.targetDistanceKm,
      adjustedDistanceKm,
      projectedVdot,
      paceChangePct,
      distanceChangePct,
      estimatedLoad,
      isRest: isRest || rf < 0,
      hasSequencingConflict,
    });
  }

  return results;
}

// ── Helpers ──────────────────────────────────────────────────

function estimateDayLoad(day: PlanDay, sliderMultiplier: number): number {
  if (day.runType === "rest") return 0;

  const intensity = INTENSITY_MULTIPLIER[day.runType] ?? 0.6;
  const paceFactor = 1.0;
  const baseLoad = day.targetDistanceKm * paceFactor * intensity;

  // Add gym load estimate if gym day (~40 scaled cross-modal load for avg session)
  const gymLoad = day.gymWorkout ? 40 : 0;

  return (baseLoad + gymLoad) * sliderMultiplier;
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
