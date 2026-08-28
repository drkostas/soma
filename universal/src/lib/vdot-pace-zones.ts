/**
 * VDOT Pace Zone Engine
 *
 * Daniels/Gilbert pace zone lookup with interpolation, HR zone targets,
 * and half-marathon time predictions. Replaces the single DEFAULT_BASE_PACE
 * with run-type-specific paces derived from the athlete's current VDOT.
 *
 * Reference: Jack Daniels, "Daniels' Running Formula" (3rd ed., 2014)
 */

// ============================================================
// VDOT TABLE — sec/km paces + HM prediction for VDOT 35–60
// ============================================================

export interface VdotPaces {
  easy: number;
  marathon: number;
  threshold: number;
  interval: number;
  repetition: number;
  /** Half-marathon prediction in seconds */
  hmSeconds: number;
}

export const VDOT_TABLE: Record<number, VdotPaces> = {
  35: { easy: 421, marathon: 364, threshold: 340, interval: 312, repetition: 298, hmSeconds: 7453 },
  36: { easy: 412, marathon: 356, threshold: 333, interval: 305, repetition: 288, hmSeconds: 7279 },
  37: { easy: 403, marathon: 348, threshold: 325, interval: 300, repetition: 282, hmSeconds: 7114 },
  38: { easy: 395, marathon: 341, threshold: 319, interval: 294, repetition: 275, hmSeconds: 6955 },
  39: { easy: 387, marathon: 334, threshold: 312, interval: 288, repetition: 270, hmSeconds: 6804 },
  40: { easy: 379, marathon: 327, threshold: 306, interval: 282, repetition: 265, hmSeconds: 6659 },
  41: { easy: 372, marathon: 320, threshold: 300, interval: 276, repetition: 260, hmSeconds: 6520 },
  42: { easy: 365, marathon: 314, threshold: 294, interval: 271, repetition: 255, hmSeconds: 6387 },
  43: { easy: 358, marathon: 308, threshold: 289, interval: 266, repetition: 250, hmSeconds: 6260 },
  44: { easy: 352, marathon: 302, threshold: 283, interval: 261, repetition: 245, hmSeconds: 6137 },
  45: { easy: 346, marathon: 296, threshold: 278, interval: 256, repetition: 240, hmSeconds: 6020 },
  46: { easy: 340, marathon: 291, threshold: 273, interval: 252, repetition: 235, hmSeconds: 5907 },
  47: { easy: 334, marathon: 286, threshold: 269, interval: 247, repetition: 230, hmSeconds: 5798 },
  48: { easy: 328, marathon: 281, threshold: 264, interval: 243, repetition: 225, hmSeconds: 5693 },
  49: { easy: 323, marathon: 276, threshold: 260, interval: 239, repetition: 222, hmSeconds: 5592 },
  50: { easy: 318, marathon: 272, threshold: 255, interval: 235, repetition: 218, hmSeconds: 5495 },
  51: { easy: 313, marathon: 267, threshold: 251, interval: 231, repetition: 215, hmSeconds: 5402 },
  52: { easy: 308, marathon: 262, threshold: 247, interval: 228, repetition: 212, hmSeconds: 5311 },
  53: { easy: 304, marathon: 258, threshold: 244, interval: 224, repetition: 210, hmSeconds: 5224 },
  54: { easy: 299, marathon: 254, threshold: 240, interval: 221, repetition: 205, hmSeconds: 5140 },
  55: { easy: 295, marathon: 250, threshold: 236, interval: 217, repetition: 202, hmSeconds: 5058 },
  56: { easy: 290, marathon: 247, threshold: 233, interval: 214, repetition: 200, hmSeconds: 4980 },
  57: { easy: 286, marathon: 243, threshold: 230, interval: 211, repetition: 198, hmSeconds: 4903 },
  58: { easy: 282, marathon: 239, threshold: 225, interval: 208, repetition: 192, hmSeconds: 4830 },
  59: { easy: 278, marathon: 236, threshold: 223, interval: 205, repetition: 190, hmSeconds: 4758 },
  60: { easy: 275, marathon: 232, threshold: 220, interval: 203, repetition: 188, hmSeconds: 4689 },
};

// ============================================================
// RUN TYPE → PACE ZONE MAPPING
// ============================================================

export type PaceZone = keyof Omit<VdotPaces, "hmSeconds">;

/**
 * Maps user-facing run type names to VDOT pace zones.
 * Recovery/long/strides all use easy pace; tempo uses threshold; etc.
 */
export const RUN_TYPE_TO_ZONE: Record<string, PaceZone> = {
  easy: "easy",
  recovery: "easy",
  long: "easy",
  strides: "easy",
  tempo: "threshold",
  threshold: "threshold",
  intervals: "interval",
  race: "marathon",
  rest: "easy",
};

// ============================================================
// HR ZONES PER WORKOUT TYPE
// ============================================================

export interface HRZone {
  low: number;
  high: number;
  zone: string;
}

export const HR_ZONES: Record<string, HRZone> = {
  easy: { low: 130, high: 148, zone: "Z2" },
  recovery: { low: 120, high: 140, zone: "Z1-2" },
  long: { low: 130, high: 152, zone: "Z2-3" },
  tempo: { low: 160, high: 172, zone: "Z4" },
  threshold: { low: 160, high: 172, zone: "Z4" },
  intervals: { low: 172, high: 185, zone: "Z5" },
  strides: { low: 150, high: 175, zone: "Z3-4" },
  race: { low: 165, high: 178, zone: "Z4-5" },
};

// ============================================================
// INTERPOLATION HELPERS
// ============================================================

const VDOT_MIN = 35;
const VDOT_MAX = 60;

/**
 * Clamp VDOT to the table range [35, 60].
 */
function clampVdot(vdot: number): number {
  return Math.max(VDOT_MIN, Math.min(VDOT_MAX, vdot));
}

/**
 * Linearly interpolate between two values.
 */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Interpolate a specific field from the VDOT table for a fractional VDOT value.
 * E.g. VDOT 47.5 returns the midpoint between VDOT 47 and VDOT 48 for that field.
 */
function interpolateField(
  vdot: number,
  field: keyof VdotPaces,
): number {
  const clamped = clampVdot(vdot);
  const low = Math.floor(clamped);
  const high = Math.ceil(clamped);

  if (low === high) return VDOT_TABLE[low][field];

  const t = clamped - low;
  return lerp(VDOT_TABLE[low][field], VDOT_TABLE[high][field], t);
}

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Get the target pace in sec/km for a given VDOT and run type.
 *
 * Interpolates between integer VDOT values in the table.
 * Falls back to "easy" zone if the run type is unknown.
 *
 * @param vdot - Current VDOT (can be fractional, clamped to 35–60)
 * @param runType - Workout type (e.g. "easy", "tempo", "intervals")
 * @returns Pace in seconds per kilometer
 */
export function getBasePace(vdot: number, runType: string): number {
  const zone = RUN_TYPE_TO_ZONE[runType.toLowerCase()] ?? "easy";
  return Math.round(interpolateField(vdot, zone));
}

/**
 * Get HR zone target for a run type.
 *
 * @param runType - Workout type (e.g. "easy", "tempo", "intervals")
 * @returns HR zone with low/high BPM and zone label, or easy zone as fallback
 */
export function getHRZone(runType: string): HRZone {
  return HR_ZONES[runType.toLowerCase()] ?? HR_ZONES.easy;
}

/**
 * Get interpolated half-marathon time prediction for a VDOT value.
 *
 * @param vdot - Current VDOT (can be fractional, clamped to 35–60)
 * @returns Predicted HM finish time in seconds
 */
export function getHMPrediction(vdot: number): number {
  return Math.round(interpolateField(vdot, "hmSeconds"));
}
