/**
 * M1 Safety Rails — TypeScript mirror of Python canonical.
 *
 * Source of truth: src/macro_engine/{tier,bmr,floor,rate_cap,fat_floor,
 * protein_floor,deficit_duration}.py
 *
 * Any changes here must be mirrored in Python (and vice versa).
 *
 * Research basis: SOMA-NUTRITION-SCIENCE-V2.md §3-§4
 */

// ============================================================================
// TIER FRAMEWORK (M1.1) — BF%-based master mode selector
// ============================================================================

export const HYSTERESIS_PCT = 1.0;

export type Tier = "T1" | "T2" | "T3" | "T4" | "T5";

export type BiomarkerCadence = "weekly" | "daily" | "daily+bloods";

export interface TierPolicy {
  tier: Tier;
  bfRange: [number, number];
  rateCapSoftPctPerWk: number;
  rateCapHardPctPerWk: number;
  proteinGPerKgBw: number;
  proteinGPerKgLbmBasis: boolean;
  fatFloorGPerKgBwSoft: number;
  fatFloorGPerKgBwHard: number;
  aggressiveModeAllowed: boolean;
  refeedFrequencyDays: number;
  dietBreakFrequencyWeeks: number;
  biomarkerCadence: BiomarkerCadence;
  durationEnvelopeWeeks: [number, number];
}

export function computeTierRaw(bfPct: number): Tier {
  if (bfPct >= 28.0) return "T1";
  if (bfPct >= 20.0) return "T2";
  if (bfPct >= 15.0) return "T3";
  if (bfPct >= 10.0) return "T4";
  return "T5";
}

// Upper bound of each tier (ascending leanness = descending BF%)
const TIER_UPPER_BOUND: Record<Tier, number> = {
  T5: 10.0,
  T4: 15.0,
  T3: 20.0,
  T2: 28.0,
  T1: Infinity,
};

// Upper bound of the tier immediately leaner than a given tier
// (= the given tier's lower boundary)
const LEANER_TIER_UPPER: Record<Tier, number> = {
  T1: 28.0,
  T2: 20.0,
  T3: 15.0,
  T4: 10.0,
  T5: 0.0,
};

const TIER_ORDER: Record<Tier, number> = { T1: 1, T2: 2, T3: 3, T4: 4, T5: 5 };

export function computeTier(bfPct: number, previousTier?: Tier): Tier {
  const raw = computeTierRaw(bfPct);
  if (previousTier === undefined || raw === previousTier) return raw;

  if (TIER_ORDER[raw] > TIER_ORDER[previousTier]) {
    // Moving leaner: must drop below previous tier's lower edge - hysteresis
    const threshold = LEANER_TIER_UPPER[previousTier] - HYSTERESIS_PCT;
    return bfPct <= threshold ? raw : previousTier;
  }
  // Moving fatter: must rise above previous tier's upper edge + hysteresis
  const threshold = TIER_UPPER_BOUND[previousTier] + HYSTERESIS_PCT;
  return bfPct >= threshold ? raw : previousTier;
}

export function rollingMedianBf(readings: number[]): number {
  if (readings.length === 0) {
    throw new Error("rollingMedianBf requires at least one reading");
  }
  const sorted = [...readings].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 1) return sorted[0];
  if (n % 2 === 0) return (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  return sorted[Math.floor(n / 2)];
}

const TIER_POLICIES: Record<Tier, TierPolicy> = {
  T1: {
    tier: "T1", bfRange: [28.0, Infinity],
    rateCapSoftPctPerWk: 1.0, rateCapHardPctPerWk: 1.25,
    proteinGPerKgBw: 2.0, proteinGPerKgLbmBasis: false,
    fatFloorGPerKgBwSoft: 0.8, fatFloorGPerKgBwHard: 0.6,
    aggressiveModeAllowed: true,
    refeedFrequencyDays: 14, dietBreakFrequencyWeeks: 12,
    biomarkerCadence: "weekly", durationEnvelopeWeeks: [12, 24],
  },
  T2: {
    tier: "T2", bfRange: [20.0, 28.0],
    rateCapSoftPctPerWk: 0.75, rateCapHardPctPerWk: 1.0,
    proteinGPerKgBw: 2.2, proteinGPerKgLbmBasis: false,
    fatFloorGPerKgBwSoft: 0.8, fatFloorGPerKgBwHard: 0.6,
    aggressiveModeAllowed: true,
    refeedFrequencyDays: 14, dietBreakFrequencyWeeks: 12,
    biomarkerCadence: "weekly", durationEnvelopeWeeks: [12, 16],
  },
  T3: {
    tier: "T3", bfRange: [15.0, 20.0],
    rateCapSoftPctPerWk: 0.5, rateCapHardPctPerWk: 0.75,
    proteinGPerKgBw: 2.4, proteinGPerKgLbmBasis: false,
    fatFloorGPerKgBwSoft: 0.8, fatFloorGPerKgBwHard: 0.6,
    aggressiveModeAllowed: false, // BLOCKED at T3
    refeedFrequencyDays: 7, dietBreakFrequencyWeeks: 10,
    biomarkerCadence: "weekly", durationEnvelopeWeeks: [16, 20],
  },
  T4: {
    tier: "T4", bfRange: [10.0, 15.0],
    rateCapSoftPctPerWk: 0.4, rateCapHardPctPerWk: 0.5,
    proteinGPerKgBw: 2.8, proteinGPerKgLbmBasis: true, // LBM basis at T4+
    fatFloorGPerKgBwSoft: 0.8, fatFloorGPerKgBwHard: 0.6,
    aggressiveModeAllowed: false,
    refeedFrequencyDays: 5, dietBreakFrequencyWeeks: 8,
    biomarkerCadence: "daily", durationEnvelopeWeeks: [8, 12],
  },
  T5: {
    tier: "T5", bfRange: [0.0, 10.0],
    rateCapSoftPctPerWk: 0.3, rateCapHardPctPerWk: 0.4,
    proteinGPerKgBw: 3.0, proteinGPerKgLbmBasis: true,
    fatFloorGPerKgBwSoft: 0.8, fatFloorGPerKgBwHard: 0.6,
    aggressiveModeAllowed: false,
    refeedFrequencyDays: 3, dietBreakFrequencyWeeks: 6,
    biomarkerCadence: "daily+bloods", durationEnvelopeWeeks: [4, 8],
  },
};

export function getTierPolicy(tier: Tier): TierPolicy {
  return TIER_POLICIES[tier];
}

// ============================================================================
// BMR (M1.2)
// ============================================================================

export type Sex = "male" | "female";

/** Cunningham 1980: BMR = 500 + 22 × FFM_kg (primary for trained athletes). */
export function cunningham(ffmKg: number): number {
  if (ffmKg <= 0) throw new Error(`ffmKg must be positive, got ${ffmKg}`);
  return Math.round(500 + 22 * ffmKg);
}

/** Mifflin-St Jeor 1990: demographic BMR. Good for general/obese; under-predicts in lean trained. */
export function mifflinStJeor(weightKg: number, heightCm: number, age: number, sex: Sex): number {
  if (weightKg <= 0 || heightCm <= 0 || age <= 0) {
    throw new Error("weightKg, heightCm, age must all be positive");
  }
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return Math.round(sex === "male" ? base + 5 : base - 161);
}

/** ten Haaf 2014 weight-based (athletes). Better than Mifflin for trained populations. */
export function tenHaafWeight(weightKg: number, heightCm: number, age: number, sex: Sex): number {
  if (weightKg <= 0 || heightCm <= 0 || age <= 0) {
    throw new Error("weightKg, heightCm, age must all be positive");
  }
  const heightM = heightCm / 100;
  const sexMale = sex === "male" ? 1 : 0;
  const kcal = 11.936 * weightKg + 587.728 * heightM - 8.129 * age + 191.027 * sexMale + 29.279;
  return Math.round(kcal);
}

/** Route to the best BMR formula given inputs. FFM → Cunningham; else → ten Haaf. */
export function computeBmr(opts: {
  ffmKg?: number;
  weightKg?: number;
  heightCm?: number;
  age?: number;
  sex?: Sex;
}): number {
  if (opts.ffmKg !== undefined) return cunningham(opts.ffmKg);
  if (
    opts.weightKg !== undefined && opts.heightCm !== undefined &&
    opts.age !== undefined && opts.sex !== undefined
  ) {
    return tenHaafWeight(opts.weightKg, opts.heightCm, opts.age, opts.sex);
  }
  throw new Error(
    "computeBmr requires either ffmKg or full demographics (weightKg + heightCm + age + sex)",
  );
}

// ============================================================================
// BMR + RED-S EA FLOOR (M1.3)
// ============================================================================

export const REDS_EA_COEFFICIENT = 25; // kcal per kg FFM per day (Mountjoy 2018)

export type FloorMode = "standard" | "aggressive";

export type FloorBreachType = "none" | "soft" | "hard";

export interface FloorResult {
  softFloor: number;
  hardFloor: number;
  targetKcal: number;
  breachType: FloorBreachType;
}

export function computeFloor(ffmKg: number, exerciseKcal: number, mode: FloorMode): {
  softFloor: number; hardFloor: number;
} {
  if (mode !== "standard" && mode !== "aggressive") {
    throw new Error(`Unknown mode: ${mode}`);
  }
  if (ffmKg <= 0) throw new Error(`ffmKg must be positive`);
  if (exerciseKcal < 0) throw new Error(`exerciseKcal must be non-negative`);

  const soft = cunningham(ffmKg);
  const eaThreshold = Math.round(REDS_EA_COEFFICIENT * ffmKg + exerciseKcal);
  const hard = mode === "standard" ? Math.max(soft, eaThreshold) : eaThreshold;
  return { softFloor: soft, hardFloor: hard };
}

export function applyFloor(
  targetKcal: number, ffmKg: number, exerciseKcal: number, mode: FloorMode,
): FloorResult {
  const { softFloor, hardFloor } = computeFloor(ffmKg, exerciseKcal, mode);

  if (targetKcal < hardFloor) {
    return { softFloor, hardFloor, targetKcal: hardFloor, breachType: "hard" };
  }
  if (targetKcal < softFloor) {
    return { softFloor, hardFloor, targetKcal, breachType: "soft" };
  }
  return { softFloor, hardFloor, targetKcal, breachType: "none" };
}

// ============================================================================
// 5-TIER RATE CAP (M1.4)
// ============================================================================

export type RateStatus = "green" | "yellow" | "red" | "suppressed";

export interface RateCap {
  softPctPerWk: number;
  hardPctPerWk: number;
}

export interface RateCheckResult {
  rate7DayPct: number;
  rate14DayPct: number | null;
  status: RateStatus;
  softCap: number;
  hardCap: number;
}

const STANDARD_RATE_CAPS: Record<Tier, [number, number]> = {
  T1: [1.0, 1.25],
  T2: [0.75, 1.0],
  T3: [0.5, 0.75],
  T4: [0.4, 0.5],
  T5: [0.3, 0.4],
};

const TIER_SEQ: Tier[] = ["T5", "T4", "T3", "T2", "T1"];

export function getRateCap(tier: Tier, mode: FloorMode = "standard"): RateCap {
  if (mode !== "standard" && mode !== "aggressive") {
    throw new Error(`Unknown mode: ${mode}`);
  }
  let effective = tier;
  if (mode === "aggressive") {
    const idx = TIER_SEQ.indexOf(tier);
    const loosenedIdx = Math.min(idx + 1, TIER_SEQ.length - 1);
    effective = TIER_SEQ[loosenedIdx];
  }
  const [soft, hard] = STANDARD_RATE_CAPS[effective];
  return { softPctPerWk: soft, hardPctPerWk: hard };
}

export function computeWeeklyRatePct(
  dailyWeights: number[], currentWeightKg?: number,
): number {
  if (dailyWeights.length < 2) {
    throw new Error(`Need at least 2 daily weights, got ${dailyWeights.length}`);
  }
  const ref = currentWeightKg ?? dailyWeights[dailyWeights.length - 1];
  const n = dailyWeights.length;
  const meanX = (n - 1) / 2;
  const meanY = dailyWeights.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (dailyWeights[i] - meanY);
    den += (i - meanX) ** 2;
  }
  const slopeKgPerDay = num / den;
  return ((slopeKgPerDay * 7) / ref) * 100;
}

export function checkRateCap(
  weights: number[],
  tier: Tier,
  mode: FloorMode,
  currentWeightKg: number,
  daysSinceCutStart: number,
): RateCheckResult {
  const cap = getRateCap(tier, mode);

  const safeRate = (ws: number[]): number => {
    if (ws.length < 2) return 0;
    return computeWeeklyRatePct(ws, currentWeightKg);
  };

  if (daysSinceCutStart < 14) {
    const rate7 = safeRate(weights.slice(-7));
    return {
      rate7DayPct: rate7, rate14DayPct: null,
      status: "suppressed",
      softCap: cap.softPctPerWk, hardCap: cap.hardPctPerWk,
    };
  }

  const rate7 = safeRate(weights.slice(-7));
  const rate14 = weights.length >= 14 ? safeRate(weights.slice(-14)) : null;

  // Magnitudes (ignore gains for a cut)
  const rate7Mag = rate7 < 0 ? -rate7 : 0;
  const rate14Mag = rate14 !== null && rate14 < 0 ? -rate14 : 0;

  let status: RateStatus;
  if (rate7Mag > cap.hardPctPerWk && rate14 !== null && rate14Mag > cap.hardPctPerWk) {
    status = "red";
  } else if (rate7Mag > cap.softPctPerWk) {
    status = "yellow";
  } else {
    status = "green";
  }

  return {
    rate7DayPct: rate7, rate14DayPct: rate14, status,
    softCap: cap.softPctPerWk, hardCap: cap.hardPctPerWk,
  };
}

// ============================================================================
// FAT FLOOR (M1.5)
// ============================================================================

export type FatMode = "standard" | "aggressive" | "maintenance" | "bulk";
export type FatBreachType = "none" | "soft" | "hard";

export interface FatFloorResult {
  softFloorG: number;
  hardFloorG: number;
  fatG: number;
  breachType: FatBreachType;
}

export const FAT_FLOOR_SOFT_DEFAULT = 0.8;
export const FAT_FLOOR_HARD = 0.6;
export const FAT_TARGET_MAINTENANCE = 1.0;

function softFloorPerKg(mode: FatMode): number {
  return mode === "maintenance" ? FAT_TARGET_MAINTENANCE : FAT_FLOOR_SOFT_DEFAULT;
}

export function computeFatFloor(weightKg: number, mode: FatMode): { softFloorG: number; hardFloorG: number } {
  if (!["standard", "aggressive", "maintenance", "bulk"].includes(mode)) {
    throw new Error(`Unknown mode: ${mode}`);
  }
  if (weightKg <= 0) throw new Error("weightKg must be positive");
  return {
    softFloorG: Math.round(softFloorPerKg(mode) * weightKg),
    hardFloorG: Math.round(FAT_FLOOR_HARD * weightKg),
  };
}

export function applyFatFloor(fatG: number, weightKg: number, mode: FatMode): FatFloorResult {
  const { softFloorG, hardFloorG } = computeFatFloor(weightKg, mode);
  if (fatG < hardFloorG) {
    return { softFloorG, hardFloorG, fatG: hardFloorG, breachType: "hard" };
  }
  if (fatG < softFloorG) {
    return { softFloorG, hardFloorG, fatG, breachType: "soft" };
  }
  return { softFloorG, hardFloorG, fatG, breachType: "none" };
}

// ============================================================================
// PROTEIN FLOOR + PER-MEAL (M1.6)
// ============================================================================

export const PROTEIN_FLOOR_G_PER_KG = 1.6;

export type ProteinFloorStatus = "green" | "amber";
export type PerMealProteinLevel = "red" | "amber" | "yellow" | "green" | "no_warning";

export interface ProteinFloorResult {
  floorG: number;
  daysBelowFloor: number;
  status: ProteinFloorStatus;
}

export function computeProteinFloor(weightKg: number): number {
  if (weightKg <= 0) throw new Error("weightKg must be positive");
  return Math.round(PROTEIN_FLOOR_G_PER_KG * weightKg);
}

export function checkProteinFloor(recentIntakes: number[], weightKg: number): ProteinFloorResult {
  const floor = computeProteinFloor(weightKg);
  let streak = 0;
  for (let i = recentIntakes.length - 1; i >= 0; i--) {
    if (recentIntakes[i] < floor) streak++;
    else break;
  }
  return {
    floorG: floor,
    daysBelowFloor: streak,
    status: streak >= 3 ? "amber" : "green",
  };
}

export function checkPerMealProtein(proteinG: number): PerMealProteinLevel {
  if (proteinG <= 14) return "red";
  if (proteinG <= 24) return "amber";
  if (proteinG <= 29) return "yellow";
  if (proteinG <= 55) return "green";
  return "no_warning";
}

// ============================================================================
// DEFICIT DURATION (M1.7)
// ============================================================================

export const DEFICIT_RATIO_THRESHOLD = 0.95;
const DEFAULT_SOFT_WARN = 56;
const DEFAULT_STRONG = 84;
const DEFAULT_HARD_STOP = 112;
const SEVERITY_OFFSET_DAYS = 28;
const FULL_RESET_MAINTENANCE_DAYS = 7;
const HALF_RESET_MIN_DAYS = 3;

export type CounterStatus = "green" | "warn" | "strong" | "hard_stop";

export interface DurationThresholds {
  softWarnDays: number;
  strongRecommendDays: number;
  hardStopDays: number;
}

export interface DayEntry {
  intakeKcal: number;
  tdeeKcal: number;
}

function isDeficitDay(day: DayEntry): boolean {
  if (day.tdeeKcal <= 0) return false;
  return day.intakeKcal < DEFICIT_RATIO_THRESHOLD * day.tdeeKcal;
}

export function computeCounter(days: DayEntry[]): number {
  let counter = 0;
  let maintenanceStreak = 0;

  for (const day of days) {
    if (isDeficitDay(day)) {
      if (maintenanceStreak >= FULL_RESET_MAINTENANCE_DAYS) {
        counter = 0;
      } else if (maintenanceStreak >= HALF_RESET_MIN_DAYS) {
        counter = Math.floor(counter / 2);
      }
      maintenanceStreak = 0;
      counter++;
    } else {
      maintenanceStreak++;
    }
  }
  return counter;
}

export function getThresholds(avgDeficitPct: number): DurationThresholds {
  let offset = 0;
  if (avgDeficitPct > 25.0) offset = -SEVERITY_OFFSET_DAYS;
  else if (avgDeficitPct < 15.0) offset = +SEVERITY_OFFSET_DAYS;

  return {
    softWarnDays: DEFAULT_SOFT_WARN + offset,
    strongRecommendDays: DEFAULT_STRONG + offset,
    hardStopDays: DEFAULT_HARD_STOP + offset,
  };
}

export function classifyCounter(counter: number, thresholds: DurationThresholds): CounterStatus {
  if (counter >= thresholds.hardStopDays) return "hard_stop";
  if (counter >= thresholds.strongRecommendDays) return "strong";
  if (counter >= thresholds.softWarnDays) return "warn";
  return "green";
}
