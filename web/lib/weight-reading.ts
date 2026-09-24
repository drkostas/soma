/**
 * A weigh-in on its way in from the phone, and the rules for accepting one.
 *
 * ⛔ THIS IS A PURE MODULE ON PURPOSE. The route around it cannot be tested here, and the parts
 * worth pinning are the bounds and the unit conversion: a scale that reports pounds, a stray zero,
 * or a body fat of 180% must not reach his log, because every downstream figure (TDEE, the deficit,
 * the trajectory) is computed from this number.
 */

/** What the phone sends for one Health Connect record. */
export interface IncomingWeight {
  /** Health Connect's own record id. The key that makes a re-read a no-op. */
  externalId?: string | null;
  /** When the scale measured it, as an ISO instant. */
  at?: string | null;
  weightKg?: number | null;
  bodyFatPct?: number | null;
  bodyWaterPct?: number | null;
  muscleMassKg?: number | null;
  boneMassKg?: number | null;
  bmi?: number | null;
  source?: string | null;
}

export interface AcceptedWeight {
  date: string;
  measuredAt: string;
  weightGrams: number;
  bodyFatPct: number | null;
  bodyWaterPct: number | null;
  muscleMassGrams: number | null;
  boneMassGrams: number | null;
  bmi: number | null;
  sourceType: string;
  externalId: string | null;
}

/**
 * Bounds a human weigh-in. Anything outside is a unit mistake or a broken scale, not him.
 *
 * 30 to 250 kg. Narrower would be presumptuous and wider would let a pounds-for-kilos error
 * through: 73 kg read as 73 lb is 33 kg, which this still admits, so the app sends kilograms and
 * this is the backstop rather than the check.
 */
export const MIN_KG = 30;
export const MAX_KG = 250;

function pct(v: unknown): number | null {
  const n = typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > 100) return null;
  return Math.round(n * 10) / 10;
}

function kgToGrams(v: unknown): number | null {
  const n = typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > MAX_KG) return null;
  return Math.round(n * 1000);
}

/**
 * Turn one incoming record into a row, or say why not.
 *
 * `tz` is the device's zone, because the calendar day a weigh-in belongs to is the day it was on
 * HIS clock. A 00:30 weigh-in in Athens is not the previous day just because the server is in UTC.
 */
export function acceptWeight(
  r: IncomingWeight,
  tz: string,
  now: Date = new Date(),
): { ok: true; row: AcceptedWeight } | { ok: false; why: string } {
  const kg = typeof r.weightKg === "number" ? r.weightKg : NaN;
  if (!Number.isFinite(kg)) return { ok: false, why: "no weight" };
  if (kg < MIN_KG || kg > MAX_KG) return { ok: false, why: `${kg} kg is outside ${MIN_KG}-${MAX_KG}` };

  const measured = r.at ? new Date(r.at) : now;
  if (Number.isNaN(measured.getTime())) return { ok: false, why: "unreadable timestamp" };
  // A scale cannot weigh him tomorrow. A clock skewed forward would otherwise write a future day,
  // which the planner reads as a plan rather than a record.
  if (measured.getTime() > now.getTime() + 60 * 60 * 1000) return { ok: false, why: "measured in the future" };

  return {
    ok: true,
    row: {
      date: measured.toLocaleDateString("en-CA", { timeZone: tz }),
      measuredAt: measured.toISOString(),
      weightGrams: Math.round(kg * 1000),
      bodyFatPct: pct(r.bodyFatPct),
      bodyWaterPct: pct(r.bodyWaterPct),
      muscleMassGrams: kgToGrams(r.muscleMassKg),
      boneMassGrams: kgToGrams(r.boneMassKg),
      bmi: typeof r.bmi === "number" && Number.isFinite(r.bmi) && r.bmi > 0 && r.bmi < 100
        ? Math.round(r.bmi * 10) / 10
        : null,
      sourceType: (r.source || "HEALTH_CONNECT").slice(0, 20),
      externalId: r.externalId ? String(r.externalId).slice(0, 200) : null,
    },
  };
}
