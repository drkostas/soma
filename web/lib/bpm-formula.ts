/**
 * HR → music BPM formula — TS port of sync/src/bpm_formula.py. Piecewise-linear
 * %HRR → target-BPM mapping (Karageorghis; Weber's 5-BPM JND). Pure. Used by the
 * live DJ daemon. Stage: sync cutover (#187).
 */

// Piecewise anchors: (pct_hrr, target_bpm). Linear interpolation between them.
const ANCHORS: Array<[number, number]> = [
  [0.0, 75], [0.1, 85], [0.2, 95], [0.3, 105], [0.4, 118], [0.45, 124],
  [0.5, 128], [0.55, 132], [0.6, 136], [0.65, 140], [0.7, 145], [0.75, 150],
  [0.8, 155], [0.85, 162], [0.9, 168], [0.95, 175], [1.0, 175],
];
export const BPM_FLOOR = 70;
export const BPM_CEILING = 185;

/** Python round() (ties to even). base_bpm interpolation can land on x.5. */
function pyRound(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

/** Convert heart rate to target music BPM via the %HRR piecewise formula. */
export function hrrToBpm(hr: number, hrRest = 60.0, hrMax = 190.0, offset = 0): number {
  let pct = (hr - hrRest) / Math.max(hrMax - hrRest, 1);
  pct = Math.max(0.0, Math.min(1.0, pct));

  let baseBpm = ANCHORS[0][1];
  for (let i = 0; i < ANCHORS.length - 1; i++) {
    const [loPct, loBpm] = ANCHORS[i];
    const [hiPct, hiBpm] = ANCHORS[i + 1];
    if (loPct <= pct && pct <= hiPct) {
      const t = hiPct > loPct ? (pct - loPct) / (hiPct - loPct) : 0.0;
      baseBpm = pyRound(loBpm + t * (hiBpm - loBpm));
      break;
    }
  }
  return Math.trunc(Math.max(BPM_FLOOR, Math.min(BPM_CEILING, baseBpm + offset)));
}

/**
 * Most recent valid HR reading within the window from Garmin heart_rates data.
 * Returns [hr_bpm, reading_timestamp_seconds] or null. Port of
 * latest_hr_from_garmin_data.
 */
export function latestHrFromGarminData(
  data: { heartRateValues?: Array<[number, number | null]> | null },
  windowSeconds = 120,
  nowMs: number = Date.now(),
): [number, number] | null {
  const readings = data.heartRateValues || [];
  const cutoffMs = nowMs - windowSeconds * 1000;
  for (let i = readings.length - 1; i >= 0; i--) {
    const [timestampMs, hrValue] = readings[i];
    if (hrValue === null || hrValue === undefined) continue;
    if (timestampMs >= cutoffMs) return [Math.trunc(hrValue), timestampMs / 1000.0];
  }
  return null;
}
