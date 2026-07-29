/**
 * Canonical readiness helpers (web), mirroring universal/src/lib/readiness.ts so
 * soma's model readiness renders the same 0-100 number on every surface.
 *
 * The model readiness is a signed z-composite; map it to its normal-distribution
 * percentile for a bounded, interpretable 0-100 score. Garmin's own readiness is
 * shown separately (comparison / secondary line), never mixed into this number.
 */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

/** Normal-distribution percentile (0-100) of a readiness z-composite. */
export function readinessScore(z: number): number {
  return Math.round(50 * (1 + erf(z / Math.SQRT2)));
}

/** Tailwind text-color class for a model traffic light. */
export function trafficLightText(light: string | null | undefined): string {
  switch (light) {
    case "green":
      return "text-green-400";
    case "yellow":
      return "text-yellow-400";
    case "red":
      return "text-red-400";
    default:
      return "text-foreground";
  }
}
