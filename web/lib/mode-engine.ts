/**
 * M2 Mode Engine — TypeScript mirror of Python canonical.
 *
 * Source of truth:
 *   src/macro_engine/mode.py
 *   src/macro_engine/mode_availability.py
 *   src/macro_engine/mode_transitions.py
 *
 * Any changes here must be mirrored in Python (and vice versa).
 *
 * Research basis: SOMA-NUTRITION-SCIENCE-V2.md §3.2, §4.5, §5, §6
 */

import type { Tier } from "./safety-rails";

// ============================================================================
// MODE ENUM + CONFIG (M2.1)
// ============================================================================

export type Mode =
  | "standard"
  | "aggressive"
  | "reverse"
  | "maintenance"
  | "bulk"
  | "injured";

export const ALL_MODES: readonly Mode[] = [
  "standard",
  "aggressive",
  "reverse",
  "maintenance",
  "bulk",
  "injured",
] as const;

export interface ModeConfig {
  tierAllowed: ReadonlySet<Tier>;
  bfHardFloorPct: number | null;
  requiresReverseBridgeFrom: ReadonlySet<Mode>;
  maxDurationDays: number | null;
}

const ALL_TIERS: ReadonlySet<Tier> = new Set<Tier>(["T1", "T2", "T3", "T4", "T5"]);

const MODE_CONFIGS: Record<Mode, ModeConfig> = {
  standard: {
    tierAllowed: new Set<Tier>(["T1", "T2", "T3", "T4"]),
    bfHardFloorPct: null,
    requiresReverseBridgeFrom: new Set<Mode>(),
    maxDurationDays: null,
  },
  aggressive: {
    tierAllowed: new Set<Tier>(["T1", "T2"]),
    bfHardFloorPct: 12.0,
    requiresReverseBridgeFrom: new Set<Mode>(),
    maxDurationDays: 84, // V2 §3.2: 12 weeks at 700-900 kcal envelope
  },
  reverse: {
    tierAllowed: ALL_TIERS,
    bfHardFloorPct: null,
    requiresReverseBridgeFrom: new Set<Mode>(),
    maxDurationDays: 42, // V2 §3.2: post-aggressive reverse 2-6 weeks
  },
  maintenance: {
    tierAllowed: ALL_TIERS,
    bfHardFloorPct: null,
    requiresReverseBridgeFrom: new Set<Mode>(),
    maxDurationDays: null,
  },
  bulk: {
    tierAllowed: new Set<Tier>(["T2", "T3", "T4", "T5"]),
    bfHardFloorPct: null,
    requiresReverseBridgeFrom: new Set<Mode>(["standard", "aggressive"]),
    maxDurationDays: 140, // V2 §6.1: 12-20 week bulk block
  },
  injured: {
    tierAllowed: ALL_TIERS,
    bfHardFloorPct: null,
    requiresReverseBridgeFrom: new Set<Mode>(),
    maxDurationDays: null,
  },
};

export function getModeConfig(mode: Mode): ModeConfig {
  return MODE_CONFIGS[mode];
}

// ============================================================================
// MODE AVAILABILITY (M2.2)
// ============================================================================

export type GateReason = "tier_not_allowed" | "bf_below_hard_floor";

export interface ModeAvailability {
  allowed: boolean;
  reason: GateReason | null;
}

export function checkModeAvailability(
  mode: Mode,
  tier: Tier,
  bfPct: number,
): ModeAvailability {
  const config = getModeConfig(mode);

  if (!config.tierAllowed.has(tier)) {
    return { allowed: false, reason: "tier_not_allowed" };
  }

  // Strictly-less-than OR equal to the floor is blocked: 12.0% BF is already
  // contraindication territory per V2 §3.2.
  if (config.bfHardFloorPct !== null && bfPct <= config.bfHardFloorPct) {
    return { allowed: false, reason: "bf_below_hard_floor" };
  }

  return { allowed: true, reason: null };
}

// ============================================================================
// MODE TRANSITIONS (M2.3)
// ============================================================================

export type TransitionReason =
  | "mode_not_available"
  | "aggressive_requires_reverse"
  | "requires_reverse_bridge";

export interface TransitionResult {
  allowed: boolean;
  reason: TransitionReason | null;
  requiresBridge: Mode | null;
}

export function checkTransition(
  current: Mode,
  nextMode: Mode,
  tier: Tier,
  bfPct: number,
): TransitionResult {
  // No-op transition is trivially allowed.
  if (current === nextMode) {
    return { allowed: true, reason: null, requiresBridge: null };
  }

  // Injury is always an escape hatch.
  if (nextMode === "injured") {
    return { allowed: true, reason: null, requiresBridge: null };
  }

  // V2 §6.4: cut → bulk must pass through a reverse bridge. Check this before
  // the generic Aggressive-exit rule so Aggressive → Bulk surfaces the more
  // actionable REQUIRES_REVERSE_BRIDGE (which carries `requiresBridge`).
  const nextConfig = getModeConfig(nextMode);
  if (nextConfig.requiresReverseBridgeFrom.has(current)) {
    return {
      allowed: false,
      reason: "requires_reverse_bridge",
      requiresBridge: "reverse",
    };
  }

  // V2 §3.2: exiting Aggressive (except to Reverse or Injured) blocked.
  if (current === "aggressive" && nextMode !== "reverse") {
    return {
      allowed: false,
      reason: "aggressive_requires_reverse",
      requiresBridge: null,
    };
  }

  // Finally, destination must be legal for the user's tier + BF%.
  const availability = checkModeAvailability(nextMode, tier, bfPct);
  if (!availability.allowed) {
    return {
      allowed: false,
      reason: "mode_not_available",
      requiresBridge: null,
    };
  }

  return { allowed: true, reason: null, requiresBridge: null };
}
