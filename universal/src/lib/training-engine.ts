/**
 * Minimal training-engine subset for the client-side forward simulation.
 * These three exports are copied verbatim from web/lib/training-engine.ts
 * (the only members forward-simulation.ts depends on); the rest of the web
 * module pulls in server-only helpers the app doesn't need.
 */

/** Default B-goal base pace: 284 sec/km (4:44/km). */
export const DEFAULT_BASE_PACE = 284.0;

/**
 * Map readiness composite-z to a pace adjustment factor.
 * Linear interpolation between anchor points.
 * Returns -1.0 as REST signal when z <= -2.
 */
export function readinessFactorCalc(z: number): number {
  if (z <= -2.0) return -1.0; // REST
  if (z >= 1.0) return 0.97;
  if (z >= 0.0) {
    // Linear: z=0 -> 1.00, z=1 -> 0.97 (slope = -0.03/unit)
    return 1.0 - 0.03 * z;
  }
  if (z >= -1.0) {
    // Linear: z=0 -> 1.00, z=-1 -> 1.05 (slope = -0.05/unit going negative)
    return 1.0 - 0.05 * z;
  }
  // z in (-2, -1): clamp at 1.05 (max slowdown before REST)
  return 1.05;
}

/**
 * Map TSB (Training Stress Balance) to pace adjustment factor.
 *
 * TSB >= +10  -> 0.98 (fresh, slightly faster)
 * TSB = 0     -> 1.00 (normal)
 * TSB <= -20  -> 1.03 (fatigued, slower)
 *
 * Linear interpolation between anchor points.
 */
export function fatigueFactorCalc(tsb: number): number {
  if (tsb >= 10.0) return 0.98;
  if (tsb <= -20.0) return 1.03;
  if (tsb >= 0.0) {
    // Linear: tsb=0 -> 1.00, tsb=10 -> 0.98 (slope = -0.002/unit)
    return 1.0 - 0.002 * tsb;
  }
  // tsb in (-20, 0): linear from 1.00 to 1.03 (slope = -0.0015/unit)
  return 1.0 - 0.0015 * tsb;
}
