/**
 * Training Engine — Client-side computation graph + types.
 *
 * Mirrors the Python merge.py logic for instant delta simulation without
 * server round-trips. All factor/pace functions are exact TypeScript ports
 * of the Python originals in sync/src/training_engine/merge.py.
 */

// ============================================================
// TYPES
// ============================================================

export type NodeColumn = "raw" | "zscore" | "pmc" | "merge" | "output";
export type TrafficLight = "green" | "yellow" | "red";
export type OverrideSeverity = "red" | "yellow";

export interface GraphNode {
  id: string;
  column: NodeColumn;
  label: string;
  value: number | null;
  unit: string;
  color: string;
  /** 0 = neutral, 1 = extreme. Used for fill-opacity intensity scaling. */
  normalizedValue?: number;
  tooltip: {
    short: string;
    formula?: string;
    source?: string;
    inputs?: string[];
  };
}

export interface GraphEdge {
  from: string;
  to: string;
  weight: number;
}

export interface Override {
  rule: string;
  triggered: boolean;
  message: string;
  severity: OverrideSeverity;
}

export interface ComputationGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  overrides: Override[];
}

export interface TrajectoryPoint {
  date: string;
  optimal: number;
  actual: number;
  shadow?: number;
}

export interface DeltaWorkout {
  dayId: number;
  dayDate: string;
  originalPace: number;
  newPace: number;
  originalDistance: number;
  newDistance: number;
  originalType: string;
  newType: string;
  changed: boolean;
  /** Per-step targets adjusted by the slider (pace/HR shifted). */
  adjustedSteps?: NormalizedStep[];
}

export interface DeltaResult {
  trajectory: TrajectoryPoint[];
  graph: ComputationGraph;
  updatedWorkouts: DeltaWorkout[];
  projectedRaceDayTSB: number;
  risk: TrafficLight;
}

export interface CalibrationInfo {
  phase: number;
  dataDays: number;
  weights: Record<string, number>;
  forceEqual: boolean;
}

export interface GraphApiResponse {
  date: string;
  graph: ComputationGraph;
  calibration: CalibrationInfo;
}

// ============================================================
// CLIENT-SIDE COMPUTATION — mirrors merge.py
// ============================================================

/** Default B-goal base pace: 284 sec/km (4:44/km). */
export const DEFAULT_BASE_PACE = 284.0;

/**
 * Map readiness z-score to pace adjustment factor.
 *
 * z <= -2  -> -1 (REST signal)
 * z = -1   -> 1.05 (5% slower)
 * z = 0    -> 1.00 (normal)
 * z >= +1  -> 0.97 (3% faster)
 *
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

/**
 * Compute adjusted pace from all factors.
 *
 * Returns null if REST is indicated (readiness z <= -2).
 * Otherwise: basePace * (1 + delta * sliderFactor)
 * where delta = (readinessFactor * fatigueFactor * weightFactor) - 1.0
 */
export function computeAdjustedPace(
  basePace: number,
  readinessZ: number,
  tsb: number,
  weightFactor: number = 1.0,
  sliderFactor: number = 1.0,
): number | null {
  const rf = readinessFactorCalc(readinessZ);
  if (rf < 0) return null; // REST

  const ff = fatigueFactorCalc(tsb);
  const combined = rf * ff * weightFactor;
  const delta = combined - 1.0;
  const adjusted = 1.0 + delta * sliderFactor;
  return basePace * adjusted;
}

// ============================================================
// STEP TARGET ADJUSTMENT
// ============================================================

import type { NormalizedStep } from "@/lib/normalize-steps";

/**
 * Adjust per-step pace/HR targets when the slider changes training intensity.
 *
 * Pace targets are scaled proportionally: if the day-level adjusted pace is
 * 5% faster than the base, each step's pace window shifts 5% faster too.
 *
 * HR targets shift by a small absolute amount: harder effort → higher HR zones.
 *
 * @param steps - The normalized workout steps to adjust.
 * @param sliderFactor - The slider multiplier (1.0 = no change).
 * @param adjustedPaceSeconds - The day-level adjusted pace (sec/km).
 * @param basePaceSeconds - The day-level base pace before slider (sec/km).
 * @returns New array of steps with adjusted targets.
 */
export function adjustStepTargets(
  steps: NormalizedStep[],
  sliderFactor: number,
  adjustedPaceSeconds: number,
  basePaceSeconds: number,
): NormalizedStep[] {
  if (sliderFactor === 1.0 || !steps?.length) return steps;
  if (!basePaceSeconds || basePaceSeconds === 0) return steps;

  const paceRatio = adjustedPaceSeconds / basePaceSeconds;

  return steps.map((step) => {
    const adjusted = { ...step };

    // Scale pace targets proportionally
    if (step.target_pace_low != null) {
      adjusted.target_pace_low = Math.round(step.target_pace_low * paceRatio);
    }
    if (step.target_pace_high != null) {
      adjusted.target_pace_high = Math.round(step.target_pace_high * paceRatio);
    }

    // HR targets shift slightly (harder effort → higher HR)
    if (step.target_hr_low != null) {
      const hrShift = Math.round((sliderFactor - 1.0) * 10);
      adjusted.target_hr_low = step.target_hr_low + hrShift;
      adjusted.target_hr_high =
        (step.target_hr_high ?? step.target_hr_low + 15) + hrShift;
    }

    return adjusted;
  });
}

// ============================================================
// COLOR UTILITIES
// ============================================================

/**
 * Return an oklch color string on a red->yellow->green gradient.
 *
 * @param value - The metric value to colorize.
 * @param thresholds - { good, bad, inverted? }
 *   When inverted=false (default): value >= good = green, value <= bad = red.
 *   When inverted=true: value >= good = red, value <= bad = green.
 */
export function nodeColor(
  value: number | null,
  thresholds: { good: number; bad: number; inverted?: boolean },
): string {
  if (value === null) return "oklch(0.7 0.05 250)"; // neutral grey-blue

  const { good, bad, inverted = false } = thresholds;

  // Normalize 0..1 where 1 = good end
  let t: number;
  if (good === bad) {
    t = 0.5;
  } else {
    t = (value - bad) / (good - bad);
  }
  if (inverted) t = 1.0 - t;
  t = Math.max(0, Math.min(1, t));

  // Hue: 0 (red) -> 90 (yellow) -> 142 (green)
  const hue = t * 142;
  // Chroma: higher in the middle (yellow), lower at ends
  const chroma = 0.15 + 0.08 * Math.sin(t * Math.PI);
  // Lightness: slightly brighter in the middle
  const lightness = 0.62 + 0.06 * Math.sin(t * Math.PI);

  return `oklch(${lightness.toFixed(3)} ${chroma.toFixed(3)} ${hue.toFixed(1)})`;
}

// ============================================================
// TOOLTIP DATABASE
// ============================================================

export interface TooltipEntry {
  short: string;
  formula?: string;
  source?: string;
}

/**
 * Static tooltip database. Every computation graph node has an entry with:
 * - short: one plain-language sentence
 * - formula (optional): the math
 * - source (optional): paper/book citation
 */
export const TOOLTIP_DB: Record<string, TooltipEntry> = {
  // --- RAW NODES ---
  hrv_raw: {
    short:
      "Your overnight heart-rate variability from Garmin, measured in milliseconds.",
    source: "Garmin avg_overnight_hrv from daily_health_summary",
  },
  sleep_raw: {
    short: "Total sleep time recorded by Garmin, in hours.",
    source: "Garmin sleep_time_seconds / 3600 from daily_health_summary",
  },
  rhr_raw: {
    short: "Resting heart rate from Garmin, in beats per minute.",
    source: "Garmin resting_heart_rate from daily_health_summary",
  },
  bb_raw: {
    short:
      "Garmin Body Battery at wake-up, a 0-100 energy score based on HRV, stress, sleep, and activity.",
    source: "Garmin body_battery_at_wake from daily_health_summary",
  },
  epoc_raw: {
    short:
      "Excess Post-exercise Oxygen Consumption: Garmin's training load metric for the most recent activity.",
    source: "Garmin activityTrainingLoad from garmin_activity_raw",
  },
  weight_raw: {
    short:
      "Latest body weight measurement from Garmin scale, in kilograms.",
    source: "weight_log table (weight_grams / 1000)",
  },

  // --- STREAM NODES (z-scores) ---
  hrv_z: {
    short:
      "HRV z-score: how today's HRV compares to your 28-day rolling baseline.",
    formula: "z = (value - mean_28d) / std_28d",
    source: "Nuuttila 2021; Plews 2013 (lnRMSSD stability)",
  },
  sleep_z: {
    short:
      "Sleep z-score: how tonight's total sleep compares to your 28-day baseline.",
    formula: "z = (sleep_sec - mean_28d) / std_28d",
  },
  rhr_z: {
    short:
      "Resting HR z-score (inverted): higher RHR yields a negative z, indicating lower readiness.",
    formula: "z = -(rhr - mean_28d) / std_28d",
    source: "Plews 2013 — elevated RHR indicates accumulated fatigue",
  },
  bb_z: {
    short:
      "Body Battery z-score: how today's wake-up energy compares to your 28-day baseline.",
    formula: "z = (bb - mean_28d) / std_28d",
  },

  // --- STREAM NODES (PMC) ---
  ctl: {
    short:
      "Chronic Training Load (fitness): 42-day exponentially weighted moving average of daily training load.",
    formula: "CTL_today = load * alpha_42 + CTL_yesterday * (1 - alpha_42)",
    source: "Banister impulse-response model (1975)",
  },
  atl: {
    short:
      "Acute Training Load (fatigue): 7-day exponentially weighted moving average of daily training load.",
    formula: "ATL_today = load * alpha_7 + ATL_yesterday * (1 - alpha_7)",
    source: "Banister impulse-response model (1975)",
  },
  tsb: {
    short:
      "Training Stress Balance: CTL minus ATL. Positive = fresh, negative = fatigued.",
    formula: "TSB = CTL - ATL",
    source: "Banister impulse-response model (1975)",
  },

  // --- STREAM NODES (body comp) ---
  weight_ema: {
    short:
      "7-day exponential moving average of body weight, smoothing daily noise from water and food.",
    formula: "EMA_today = weight * (2/8) + EMA_yesterday * (6/8)",
  },

  // --- MERGE NODES ---
  readiness_factor: {
    short:
      "Pace multiplier from readiness: maps your composite z-score to a pace adjustment (0.97-1.05).",
    formula:
      "z>=1 -> 0.97, z=0 -> 1.00, z<=-1 -> 1.05, z<=-2 -> REST (-1)",
    source: "Dawes 1979 (equal-weight composites); Nuuttila 2021 (HRV+HR PPV)",
  },
  fatigue_factor: {
    short:
      "Pace multiplier from fatigue: maps TSB to a pace adjustment (0.98-1.03).",
    formula: "TSB>=10 -> 0.98, TSB=0 -> 1.00, TSB<=-20 -> 1.03",
    source: "Banister impulse-response model",
  },
  weight_factor: {
    short:
      "Pace multiplier from weight change: heavier than calibration = slower, lighter = faster.",
    formula: "weight_current / weight_at_calibration",
    source: "Daniels (2014) — VO2max is mL/kg/min, pace scales with weight",
  },
  slider_factor: {
    short:
      "User preference slider scaling the adjustment delta. 1.0 = normal, >1.0 = amplify changes.",
    formula: "adjusted = 1.0 + (combined_delta * slider)",
  },

  // --- OUTPUT NODES ---
  adjusted_pace: {
    short:
      "Today's recommended pace in sec/km, combining readiness, fatigue, weight, and slider factors.",
    formula:
      "base_pace * (1.0 + (rf * ff * wf - 1.0) * slider)",
  },
  vdot: {
    short:
      "VDOT score adjusted for current weight: your equivalent aerobic fitness level.",
    formula: "VDOT_base * (calibration_weight / current_weight)",
    source: "Daniels/Gilbert oxygen cost model (2014)",
  },

  // --- BANISTER PARAMETERS ---
  banister_tau1: {
    short: "Personal fitness decay time constant. Fitted from your anchor runs. Population default: 42 days.",
    formula: "Fitted via differential evolution on maximal-effort runs",
    source: "Banister impulse-response model (1991)",
  },
  banister_tau2: {
    short: "Personal fatigue decay time constant. Fitted from your anchor runs. Population default: 7 days.",
    formula: "Fitted via differential evolution on maximal-effort runs",
    source: "Banister impulse-response model (1991)",
  },
  banister_p0: {
    short: "Baseline VDOT before any training effect. Starting point of the Banister model.",
    source: "Banister impulse-response model (1991)",
  },
  banister_k1: {
    short: "Fitness gain coefficient. How much each unit of training load improves fitness.",
    source: "Banister impulse-response model (1991)",
  },
  banister_k2: {
    short: "Fatigue gain coefficient. How much each unit of training load adds fatigue.",
    source: "Banister impulse-response model (1991)",
  },

  // --- FITNESS INDICATORS ---
  decoupling: {
    short:
      "Pace:HR decoupling: how much cardiac drift occurs between the first and second half of a run.",
    formula: "((EF_first - EF_second) / EF_first) * 100",
    source: "Friel — aerobic decoupling < 5% indicates good base fitness",
  },
  ef: {
    short:
      "Efficiency Factor: running speed divided by heart rate. Higher = more aerobically efficient.",
    formula: "EF = (1 / pace_sec_km) / avg_HR",
  },
};

/**
 * Look up tooltip for a node ID. Falls back to a generic entry if missing.
 */
export function getTooltip(nodeId: string): TooltipEntry {
  return (
    TOOLTIP_DB[nodeId] ?? {
      short: `Metric: ${nodeId}`,
    }
  );
}

// ============================================================
// NODE COLOR THRESHOLD PRESETS
// ============================================================

/** Threshold configs for common metrics (used by nodeColor). */
export const NODE_THRESHOLDS: Record<
  string,
  { good: number; bad: number; inverted?: boolean }
> = {
  hrv_z: { good: 1.0, bad: -2.0 },
  sleep_z: { good: 1.0, bad: -2.0 },
  rhr_z: { good: 1.0, bad: -2.0 },
  bb_z: { good: 1.0, bad: -2.0 },
  tsb: { good: 15, bad: -20 },
  ctl: { good: 60, bad: 10 },
  atl: { good: 30, bad: 80 }, // lower ATL = more rested; good<bad encodes direction
  readiness_factor: { good: 0.97, bad: 1.05 }, // lower = faster = better
  fatigue_factor: { good: 0.98, bad: 1.03 },
  weight_factor: { good: 0.97, bad: 1.03 },
  composite_score: { good: 1.0, bad: -2.0 },
  vdot: { good: 55, bad: 35 },
  decoupling: { good: 3, bad: 8 }, // lower decoupling = better
};

/**
 * Get the appropriate color for a node, using its ID to look up thresholds.
 * Falls back to neutral grey-blue if no threshold config exists.
 */
export function colorForNode(nodeId: string, value: number | null): string {
  const thresholds = NODE_THRESHOLDS[nodeId];
  if (!thresholds) return "oklch(0.7 0.05 250)";
  return nodeColor(value, thresholds);
}

// ============================================================
// FULL FORWARD-PASS RECOMPUTE FOR SLIDER
// ============================================================

/** Clamp a number to [0, 1]. */
function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Normalized value for z-scores: |z|/2 clamped to [0,1]. */
function zNorm(z: number | null): number {
  return z != null ? clamp01(Math.abs(z) / 2) : 0;
}

/** Normalized value for factor nodes: |f - 1.0| / 0.05 clamped to [0,1]. */
function factorNorm(f: number | null): number {
  return f != null ? clamp01(Math.abs(f - 1.0) / 0.05) : 0;
}

/** Compute normalizedValue for a node based on its ID and value. */
function computeNormalizedValue(nodeId: string, value: number | null): number {
  if (value == null) return 0;
  switch (nodeId) {
    // Z-score nodes
    case "hrv_z":
    case "sleep_z":
    case "rhr_z":
    case "bb_z":
      return zNorm(value);
    // Raw nodes mirror their z-score (unchanged in shadow)
    case "hrv_raw":
    case "sleep_raw":
    case "rhr_raw":
    case "bb_raw":
      return 0; // raw nodes don't change
    // PMC nodes
    case "ctl":
    case "atl":
      return clamp01(value / 100);
    case "tsb":
      return clamp01(Math.abs(value) / 30);
    // Factor nodes
    case "readiness_factor":
    case "fatigue_factor":
    case "weight_factor":
    case "slider_factor":
      return factorNorm(value);
    // Output nodes
    case "adjusted_pace":
      return clamp01(Math.abs(value - DEFAULT_BASE_PACE) / 30);
    case "vdot":
      return clamp01(value / 60);
    default:
      return 0;
  }
}

/**
 * Full client-side forward-pass recompute of the computation graph
 * given a slider multiplier value.
 *
 * The slider conceptually scales future training load. This propagates
 * through the PMC (CTL/ATL/TSB), into fatigue_factor, and finally
 * into adjusted_pace. Readiness and weight factors are biometric —
 * they don't change with training load.
 *
 * Nodes that don't change with training load (raw, z-scores, weight,
 * readiness) are left untouched.
 */
export function recomputeGraphForSlider(
  baseGraph: ComputationGraph,
  sliderValue: number,
): ComputationGraph {
  // Deep-clone nodes so we don't mutate the original
  const nodes: GraphNode[] = structuredClone(baseGraph.nodes);

  const find = (id: string) => nodes.find((n) => n.id === id);

  // ── Scale training-load-dependent PMC nodes ───────────
  // The slider scales daily training load. CTL (42d EMA) responds slowly,
  // ATL (7d EMA) responds faster.
  const loadMultiplier = sliderValue;

  const ctlNode = find("ctl");
  if (ctlNode && ctlNode.value != null) {
    const baseCTL = ctlNode.value;
    const ctlShift = (loadMultiplier - 1.0) * baseCTL * 0.15;
    ctlNode.value = Math.round((baseCTL + ctlShift) * 10) / 10;
  }

  const atlNode = find("atl");
  if (atlNode && atlNode.value != null) {
    const baseATL = atlNode.value;
    const atlShift = (loadMultiplier - 1.0) * baseATL * 0.4;
    atlNode.value = Math.round((baseATL + atlShift) * 10) / 10;
  }

  // TSB = CTL - ATL
  const tsbNode = find("tsb");
  if (tsbNode && ctlNode?.value != null && atlNode?.value != null) {
    tsbNode.value = Math.round((ctlNode.value - atlNode.value) * 10) / 10;
  }

  // ── Recompute fatigue factor from new TSB ─────────────
  const fatigueNode = find("fatigue_factor");
  if (fatigueNode && tsbNode?.value != null) {
    fatigueNode.value = Math.round(fatigueFactorCalc(tsbNode.value) * 10000) / 10000;
  }

  // ── Slider factor node ────────────────────────────────
  const sliderNode = find("slider_factor");
  if (sliderNode) {
    sliderNode.value = sliderValue;
  }

  // ── Recompute adjusted pace with all factors ──────────
  const readinessNode = find("readiness_factor");
  const weightNode = find("weight_factor");
  const adjustedPaceNode = find("adjusted_pace");

  if (adjustedPaceNode) {
    const rf = readinessNode?.value ?? 1.0;
    const ff = fatigueNode?.value ?? 1.0;
    const wf = weightNode?.value ?? 1.0;

    if (rf < 0) {
      // REST signal
      adjustedPaceNode.value = null;
    } else {
      const combined = rf * ff * wf;
      const delta = combined - 1.0;
      const adjusted = 1.0 + delta * sliderValue;
      adjustedPaceNode.value = Math.round(DEFAULT_BASE_PACE * adjusted * 10) / 10;
    }
  }

  // ── Recalculate colors and normalizedValue for all changed nodes ──
  for (const node of nodes) {
    // Special-case nodes that have bespoke color logic (not in NODE_THRESHOLDS)
    if (node.id === "slider_factor") {
      node.color = "oklch(0.7 0.12 250)";
    } else if (node.id === "adjusted_pace") {
      node.color = node.value != null ? "oklch(0.7 0.15 142)" : "oklch(0.6 0.2 25)";
    } else {
      node.color = colorForNode(node.id, node.value);
    }
    node.normalizedValue = computeNormalizedValue(node.id, node.value);
  }

  return { ...baseGraph, nodes };
}
