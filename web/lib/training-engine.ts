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

export type NodeColumn = "raw" | "stream" | "merge" | "output";
export type TrafficLight = "green" | "yellow" | "red";
export type OverrideSeverity = "red" | "yellow";

export interface GraphNode {
  id: string;
  column: NodeColumn;
  label: string;
  value: number | null;
  unit: string;
  color: string;
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
  atl: { good: 30, bad: 80, inverted: true }, // lower ATL = more rested
  readiness_factor: { good: 0.97, bad: 1.05, inverted: true }, // lower = faster = better
  fatigue_factor: { good: 0.98, bad: 1.03, inverted: true },
  weight_factor: { good: 0.97, bad: 1.03, inverted: true },
  composite_score: { good: 1.0, bad: -2.0 },
  vdot: { good: 55, bad: 35 },
  decoupling: { good: 3, bad: 8, inverted: true }, // lower decoupling = better
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
