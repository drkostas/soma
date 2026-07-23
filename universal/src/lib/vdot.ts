/**
 * VDOT pace zones — ported from web/lib/vdot-pace-zones.ts (Daniels' Running
 * Formula, 3rd ed.). Same table so the app's paces match the website exactly.
 */
export interface VdotPaces {
  easy: number;
  marathon: number;
  threshold: number;
  interval: number;
  repetition: number;
  /** Half-marathon prediction, seconds. */
  hmSeconds: number;
}

const VDOT_TABLE: Record<number, VdotPaces> = {
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

/** Interpolated pace set for a (possibly fractional) VDOT, clamped to [35,60]. */
export function pacesForVdot(vdot: number): VdotPaces {
  const v = Math.max(35, Math.min(60, vdot));
  const lo = Math.floor(v);
  const hi = Math.ceil(v);
  const t = v - lo;
  const a = VDOT_TABLE[lo];
  const b = VDOT_TABLE[hi];
  const l = (x: number, y: number) => x + (y - x) * t;
  return {
    easy: l(a.easy, b.easy),
    marathon: l(a.marathon, b.marathon),
    threshold: l(a.threshold, b.threshold),
    interval: l(a.interval, b.interval),
    repetition: l(a.repetition, b.repetition),
    hmSeconds: l(a.hmSeconds, b.hmSeconds),
  };
}

/** Seconds/km → "M:SS". */
export function paceStr(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Total seconds → "H:MM:SS" (or "M:SS" under an hour). */
export function timeStr(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.round(totalSec % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

const HM_KM = 21.0975;
/** Predicted HM race pace (sec/km) from the VDOT hm prediction. */
export const hmPace = (p: VdotPaces): number => p.hmSeconds / HM_KM;
