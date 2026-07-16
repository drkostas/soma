/**
 * Daniels/Gilbert VDOT engine — TS port of sync/src/training_engine/vdot.py.
 * Converts between race performances and training paces across Daniels zones.
 * Pure math, no I/O. Used by the fitness stream (race prediction) and later by
 * the plan generator (training paces). Stage: training engine (#187).
 *
 * References: Daniels' Running Formula 3rd ed.; Gilbert oxygen-power tables.
 */

const HM_DISTANCE_M = 21097.5;

/** Oxygen cost of running at a velocity (m/min): VO2 = -4.60 + 0.182258v + 0.000104v². */
function vo2Cost(velocityMMin: number): number {
  const v = velocityMMin;
  return -4.6 + 0.182258 * v + 0.000104 * v * v;
}

/** Fraction of VO2max sustainable for a duration (min). */
function vo2DemandFraction(timeMin: number): number {
  const t = timeMin;
  return 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t);
}

/** VDOT from a race performance = vo2Cost(velocity) / vo2DemandFraction(time). */
export function vdotFromRace(distanceM: number, timeSeconds: number): number {
  const timeMin = timeSeconds / 60.0;
  const velocity = distanceM / timeMin;
  return vo2Cost(velocity) / vo2DemandFraction(timeMin);
}

/** Velocity (m/min) at 100% VO2max for a VDOT (positive quadratic root). */
export function velocityAtVo2max(vdot: number): number {
  const a = 0.000104, b = 0.182258, c = -4.6 - vdot;
  const disc = b * b - 4 * a * c;
  if (disc < 0) throw new Error(`Cannot compute velocity for VDOT ${vdot}`);
  return (-b + Math.sqrt(disc)) / (2 * a);
}

/** Velocity (m/min) at a given fraction of VO2max. */
function velocityAtFraction(vdot: number, fraction: number): number {
  const targetVo2 = vdot * fraction;
  const a = 0.000104, b = 0.182258, c = -4.6 - targetVo2;
  const disc = b * b - 4 * a * c;
  return (-b + Math.sqrt(disc)) / (2 * a);
}

/** Predict race time (seconds) from VDOT via binary search (matches Python's 100 iters). */
export function timeFromVdot(vdot: number, distanceM: number): number {
  let lo = 60.0, hi = 86400.0;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2.0;
    const computed = vdotFromRace(distanceM, mid);
    if (computed > vdot) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2.0;
}

// Daniels zone %VO2max fractions (calibrated to the published VDOT pace tables).
export const ZONE_VO2MAX_FRACTIONS: Record<string, [number, number]> = {
  easy: [0.6435, 0.7015],
  marathon: [0.813, 0.813],
  threshold: [0.8772, 0.8772],
  interval: [0.965, 0.965],
  repetition: [1.0474, 1.0817],
};

export function percentVo2maxForZone(zone: string): [number, number] {
  const f = ZONE_VO2MAX_FRACTIONS[zone];
  if (!f) throw new Error(`Unknown zone '${zone}'. Valid: ${Object.keys(ZONE_VO2MAX_FRACTIONS).join(", ")}`);
  return f;
}

/**
 * Training pace in sec/km for a Daniels zone. easy/repetition return a
 * [fast, slow] tuple; marathon/threshold/interval return a single int (midpoint).
 */
export function paceForZone(vdot: number, zone: string): [number, number] | number {
  const [lowFrac, highFrac] = percentVo2maxForZone(zone);
  if (zone === "easy" || zone === "repetition") {
    const fastVel = velocityAtFraction(vdot, highFrac);
    const slowVel = velocityAtFraction(vdot, lowFrac);
    return [Math.round((1000.0 / fastVel) * 60.0), Math.round((1000.0 / slowVel) * 60.0)];
  }
  const midFrac = (lowFrac + highFrac) / 2.0;
  const vel = velocityAtFraction(vdot, midFrac);
  return Math.round((1000.0 / vel) * 60.0);
}

export interface Paces { E: [number, number]; M: [number, number]; T: [number, number]; I: [number, number]; R: [number, number]; }

/** All Daniels training paces for a VDOT (single-pace zones wrapped as [v, v]). */
export function allPaces(vdot: number): Paces {
  const e = paceForZone(vdot, "easy") as [number, number];
  const m = paceForZone(vdot, "marathon") as number;
  const t = paceForZone(vdot, "threshold") as number;
  const i = paceForZone(vdot, "interval") as number;
  const r = paceForZone(vdot, "repetition") as [number, number];
  return { E: e, M: [m, m], T: [t, t], I: [i, i], R: r };
}

/** Half-marathon A/B/C goal paces (sec/km): A = threshold, B = predicted HM, C = B×1.03. */
export function hmGoalPaces(vdot: number): { A: number; B: number; C: number } {
  const aPace = paceForZone(vdot, "threshold") as number;
  const hmTime = timeFromVdot(vdot, HM_DISTANCE_M);
  const bPace = Math.round(hmTime / 21.0975);
  const cPace = Math.round(bPace * 1.03);
  return { A: aPace, B: bPace, C: cPace };
}

/** Adjust VDOT for a body-weight change (VO2max scales inversely with weight). */
export function adjustVdotForWeight(vdot: number, oldWeight: number, newWeight: number): number {
  if (newWeight <= 0 || oldWeight <= 0) return vdot;
  return (vdot * oldWeight) / newWeight;
}
