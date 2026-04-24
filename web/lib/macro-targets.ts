/**
 * M4 Phase A — Macro Engine core (5-band × tier × mode).
 *
 * Source of truth: src/macro_engine/macro_targets.py
 * Any changes here must be mirrored in Python (and vice versa).
 *
 * Research basis: SOMA-NUTRITION-SCIENCE-V2.md §2
 */

import type { Mode } from "./mode-engine";
import { computeTierRaw, type Tier } from "./safety-rails";

// ============================================================================
// M4.1 — Training load + band classifier
// ============================================================================

export type Band = "rest" | "light" | "moderate" | "hard" | "very_hard";

export const ALL_BANDS: readonly Band[] = [
  "rest", "light", "moderate", "hard", "very_hard",
] as const;

const RUN_DIVISOR = 10;
const GYM_DIVISOR = 6;
const LOAD_SATURATION = 4.0;
const ENDURANCE_PRIORITY_THRESHOLD = 1.5;

export function computeTrainingLoad(
  runKcal: number,
  gymKcal: number,
  opts: { weightKg: number },
): number {
  if (runKcal < 0 || gymKcal < 0) {
    throw new RangeError(`kcal must be >= 0, got run=${runKcal} gym=${gymKcal}`);
  }
  if (opts.weightKg <= 0) {
    throw new RangeError(`weightKg must be positive, got ${opts.weightKg}`);
  }
  const runLoad = runKcal / (opts.weightKg * RUN_DIVISOR);
  const gymLoad = gymKcal / (opts.weightKg * GYM_DIVISOR);
  if (runLoad >= ENDURANCE_PRIORITY_THRESHOLD) return runLoad;
  return Math.min(runLoad + gymLoad, LOAD_SATURATION);
}

export function classifyBand(totalLoad: number): Band {
  if (totalLoad <= 0) return "rest";
  if (totalLoad <= 1.0) return "light";
  if (totalLoad <= 2.0) return "moderate";
  if (totalLoad <= 3.0) return "hard";
  return "very_hard";
}

// ============================================================================
// M4.2 — Protein formula (tier × mode × band)
// ============================================================================

type TierModeKey = `${Tier}|${Mode}`;

const PROTEIN_BASE_G_PER_KG: Record<TierModeKey, number> = {
  // Standard
  "T1|standard": 2.0, "T2|standard": 2.3, "T3|standard": 2.4,
  "T4|standard": 2.8, "T5|standard": 2.8,
  // Aggressive (T1-T2 real; others gated by M2)
  "T1|aggressive": 2.2, "T2|aggressive": 2.4, "T3|aggressive": 2.4,
  "T4|aggressive": 2.4, "T5|aggressive": 2.4,
  // Reverse mirrors Standard
  "T1|reverse": 2.0, "T2|reverse": 2.3, "T3|reverse": 2.4,
  "T4|reverse": 2.8, "T5|reverse": 2.8,
  // Maintenance flat 2.0
  "T1|maintenance": 2.0, "T2|maintenance": 2.0, "T3|maintenance": 2.0,
  "T4|maintenance": 2.0, "T5|maintenance": 2.0,
  // Bulk flat 2.0
  "T1|bulk": 2.0, "T2|bulk": 2.0, "T3|bulk": 2.0, "T4|bulk": 2.0, "T5|bulk": 2.0,
  // Injured uses Standard matrix for M4 (V2 §4.5 refines later)
  "T1|injured": 2.0, "T2|injured": 2.3, "T3|injured": 2.4,
  "T4|injured": 2.8, "T5|injured": 2.8,
};

const VERY_HARD_PROTEIN_DROP = 0.2;
const PROTEIN_ABSOLUTE_FLOOR = 1.6;

export function proteinGPerKg(tier: Tier, mode: Mode, band: Band): number {
  const key = `${tier}|${mode}` as TierModeKey;
  let base = PROTEIN_BASE_G_PER_KG[key];
  if (band === "very_hard") base -= VERY_HARD_PROTEIN_DROP;
  return Math.max(PROTEIN_ABSOLUTE_FLOOR, base);
}

// ============================================================================
// M4.3 — Carbs + fiber
// ============================================================================

const CARB_G_PER_KG: Record<Band, number> = {
  rest: 3.0, light: 3.5, moderate: 5.0, hard: 6.5, very_hard: 8.0,
};

const CARB_HEALTH_FLOOR_G = 100;
const FIBER_MIN_G = 25;
const FIBER_HARD_CEILING_G = 60;
const FIBER_CUT_BONUS_G = 5;

export function carbGPerKg(band: Band): number {
  return CARB_G_PER_KG[band];
}

export function carbTargetG(
  band: Band,
  opts: { weightKg: number; inDeficit: boolean },
): number {
  const raw = Math.round(CARB_G_PER_KG[band] * opts.weightKg);
  if (band === "rest" && opts.inDeficit) return Math.max(raw, CARB_HEALTH_FLOOR_G);
  return raw;
}

export function fiberTargetG(kcalTarget: number, opts: { inDeficit: boolean }): number {
  let base = Math.max(FIBER_MIN_G, Math.round((kcalTarget * 14) / 1000));
  if (opts.inDeficit) base += FIBER_CUT_BONUS_G;
  return Math.min(FIBER_HARD_CEILING_G, base);
}

// ============================================================================
// M4.4 — Composed macro engine
// ============================================================================

const KCAL_P = 4;
const KCAL_C = 4;
const KCAL_F = 9;
const FAT_HARD_FLOOR_G_PER_KG = 0.6;
const FAT_SOFT_FLOOR_G_PER_KG = 0.8;
const FAT_MAINTENANCE_TARGET = 1.0;
const FAT_BULK_TARGET = 1.0;

export interface MacroTargets {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
}

function fatTargetGForMode(mode: Mode, weightKg: number): number {
  if (mode === "maintenance") return FAT_MAINTENANCE_TARGET * weightKg;
  if (mode === "bulk") return FAT_BULK_TARGET * weightKg;
  return FAT_SOFT_FLOOR_G_PER_KG * weightKg;
}

export function computeMacroTargets(opts: {
  weightKg: number;
  tier: Tier;
  mode: Mode;
  band: Band;
  kcalTarget: number;
  inDeficit: boolean;
}): MacroTargets {
  const { weightKg, tier, mode, band, kcalTarget, inDeficit } = opts;

  const proteinG = Math.round(proteinGPerKg(tier, mode, band) * weightKg);
  const fiberG = fiberTargetG(kcalTarget, { inDeficit });

  const fatModeTarget = fatTargetGForMode(mode, weightKg);
  const fatHardFloor = FAT_HARD_FLOOR_G_PER_KG * weightKg;
  let fatG = Math.max(fatHardFloor, fatModeTarget);

  const bandCeiling = CARB_G_PER_KG[band] * weightKg;
  const remainderKcal = kcalTarget - proteinG * KCAL_P - fatG * KCAL_F;
  let carbsFloat = Math.min(Math.max(0, remainderKcal / KCAL_C), bandCeiling);

  if (band === "rest" && inDeficit && carbsFloat < CARB_HEALTH_FLOOR_G) {
    const kcalForFat = kcalTarget - proteinG * KCAL_P - CARB_HEALTH_FLOOR_G * KCAL_C;
    fatG = Math.max(fatHardFloor, kcalForFat / KCAL_F);
    carbsFloat = CARB_HEALTH_FLOOR_G;
  }

  const carbsG = Math.round(carbsFloat);
  const fatGInt = Math.round(fatG);
  const kcal = proteinG * KCAL_P + carbsG * KCAL_C + fatGInt * KCAL_F;

  return { kcal, proteinG, carbsG, fatG: fatGInt, fiberG };
}

// ============================================================================
// Adapter — legacy API shape for existing callers (M4.5)
// ============================================================================

export interface MacroTargetsLegacyShape {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
}

export interface MacroContextResult extends MacroTargetsLegacyShape {
  band: Band;
  tier: Tier;
}

/**
 * Adapter for legacy callers that pass profile + training context and expect
 * {calories, protein, carbs, fat, fiber} field names. Internally runs the new
 * 5-band × tier × mode engine, then remaps field names so the HTTP response
 * shape stays stable for the UI.
 *
 * When bfPct is null (common during onboarding before a body-comp anchor is
 * logged), defaults tier to T2 — a sensible midpoint for the seeded user
 * profile that won't mis-trigger the T3+ Aggressive block.
 */
export function computeMacroTargetsFromContext(opts: {
  weightKg: number;
  bfPct: number | null;
  mode: Mode;
  runKcal: number;
  gymKcal: number;
  kcalTarget: number;
  inDeficit: boolean;
}): MacroContextResult {
  const { weightKg, bfPct, mode, runKcal, gymKcal, kcalTarget, inDeficit } = opts;

  const tier: Tier = bfPct != null ? computeTierRaw(bfPct) : "T2";
  const load = computeTrainingLoad(runKcal, gymKcal, { weightKg });
  const band = classifyBand(load);

  const core = computeMacroTargets({
    weightKg, tier, mode, band, kcalTarget, inDeficit,
  });

  return {
    calories: core.kcal,
    protein: core.proteinG,
    carbs: core.carbsG,
    fat: core.fatG,
    fiber: core.fiberG,
    band,
    tier,
  };
}
