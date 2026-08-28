/** Estimate half-marathon time from VDOT using Daniels/Gilbert equations. */
export function estimateHMSeconds(vdot: number): number {
  const HM_M = 21097.5;
  // Binary search: vdot_from_race(HM_M, t) == vdot
  let lo = 60, hi = 86400;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const tMin = mid / 60;
    const vel = HM_M / tMin;
    const vo2 = -4.60 + 0.182258 * vel + 0.000104 * vel * vel;
    const frac = 0.8 + 0.1894393 * Math.exp(-0.012778 * tMin) + 0.2989558 * Math.exp(-0.1932605 * tMin);
    const computed = vo2 / frac;
    if (computed > vdot) lo = mid; else hi = mid;
  }
  return Math.round((lo + hi) / 2);
}

/** Inverse of estimateHMSeconds: given HM time in seconds, return the VDOT. */
export function vdotFromHmSeconds(seconds: number): number {
  // Higher VDOT = faster (fewer seconds)
  let lo = 20, hi = 85;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (estimateHMSeconds(mid) > seconds) lo = mid; else hi = mid;
  }
  return Math.round((lo + hi) / 2 * 10) / 10;
}
