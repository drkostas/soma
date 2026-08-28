import { runForwardSimulation, type ProjectedDay, type SimulationSeeds, type PlanDay as FsPlanDay } from "./forward-simulation";
import type { ForwardSim } from "./api";

export type { ProjectedDay };

/**
 * Run the client-side forward simulation over the forward-sim payload, mapping
 * each plan day (by id) to its projected readiness-adjusted pace / traffic
 * light. Mirrors the web dashboard, which runs the same `runForwardSimulation`
 * client-side. Returns null when the seeds needed for the projection are
 * absent (older payloads that don't carry banister / epoc scale).
 */
export function projectDays(
  sim: ForwardSim | null | undefined,
  sliderMultiplier = 1.0,
): Map<number, ProjectedDay> | null {
  if (!sim || !sim.pmc || !sim.banister || !sim.fitness || sim.fitness.vdotAdjusted == null) return null;
  const seeds: SimulationSeeds = {
    pmc: sim.pmc,
    banister: sim.banister,
    readiness: { compositeZ: sim.readiness?.compositeZ ?? 0, trafficLight: sim.readiness?.trafficLight ?? "green" },
    fitness: {
      vdotAdjusted: sim.fitness.vdotAdjusted,
      weightKg: sim.fitness.weightKg ?? 70,
      calibrationWeightKg: sim.fitness.calibrationWeightKg ?? 80.5,
    },
    planDays: sim.planDays as unknown as FsPlanDay[],
    sliderMultiplier,
    epocScaleFactor: sim.epocScaleFactor,
  };
  try {
    const m = new Map<number, ProjectedDay>();
    for (const d of runForwardSimulation(seeds)) m.set(d.dayId, d);
    return m;
  } catch {
    return null;
  }
}

/** sec/km → "M:SS". */
export function paceStr(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export const TRAFFIC_COLOR: Record<string, string> = {
  green: "#6ad4a0",
  yellow: "#e0c458",
  red: "#e06060",
};
