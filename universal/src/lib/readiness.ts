/**
 * Canonical readiness helpers, shared so every surface renders soma's model
 * readiness the SAME way.
 *
 * The model's readiness is a signed z-composite (roughly -3.5..+2, occasionally
 * higher). To headline it as a 0-100 score we map the z to its normal-distribution
 * percentile — the same mapping used in the model-vs-Garmin comparison — so the
 * overview hero, the sleep card, and the comparison all agree. (The old overview
 * used Math.round(min(1, z) * 100), which saturated to 100; other places showed
 * the raw z — three different numbers for one metric.)
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
