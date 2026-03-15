import { HR_ZONES } from "./vdot-pace-zones";

/**
 * Adapts Python backend workout step field names to TypeScript frontend names.
 *
 * Backend (plan_generator.py): step_type, duration_type, duration_value,
 *   target_type, target_pace_min, target_pace_max, description
 * Frontend (WorkoutStepEditor): type, name, distance_meters, duration_minutes,
 *   target_pace_low, target_pace_high, target_hr_low, target_hr_high, repeats
 */

export interface RawBackendStep {
  step_type?: string
  duration_type?: string
  duration_value?: number
  target_type?: string
  target_pace_min?: number
  target_pace_max?: number
  target_hr_min?: number
  target_hr_max?: number
  hr_zone?: number
  description?: string
  repeats?: number
  // Already-normalized fields (passthrough)
  type?: string
  name?: string
  target_pace_low?: number
  target_pace_high?: number
  target_hr_low?: number
  target_hr_high?: number
  distance_meters?: number
  duration_minutes?: number
}

export interface NormalizedStep {
  type: string
  name: string
  target_pace_low?: number
  target_pace_high?: number
  target_hr_low?: number
  target_hr_high?: number
  distance_meters?: number
  duration_minutes?: number
  repeats?: number
}

/**
 * Infer the run type (easy, tempo, intervals, etc.) from a normalized step
 * by checking pace, description, and step_type — in that priority order.
 *
 * The plan generator uses step_type="interval" for ALL non-recovery steps,
 * so step_type alone is unreliable. Pace is the best signal.
 */
function inferRunType(step: NormalizedStep): string {
  const desc = (step.name || "").toLowerCase();

  // Step type overrides for unambiguous types
  if (step.type === "recovery" || step.type === "rest") return "recovery";
  if (step.type === "warmup" || step.type === "cooldown") return "easy";

  // Description-based hints
  if (desc.includes("stride")) return "strides";
  if (desc.includes("easy") || desc.includes("jog")) return "easy";
  if (desc.includes("tempo")) return "tempo";
  if (desc.includes("threshold") || desc.includes("cruise")) return "threshold";
  if (desc.includes("cooldown") || desc.includes("warm")) return "easy";

  // Pace-based inference (sec/km): use midpoint of pace range
  const paceAvg = (step.target_pace_low != null && step.target_pace_high != null)
    ? (step.target_pace_low + step.target_pace_high) / 2
    : step.target_pace_low ?? step.target_pace_high ?? null;

  if (paceAvg != null) {
    // Pace thresholds (sec/km) roughly aligned with VDOT 45-55:
    // >310 = easy/recovery, 260-310 = marathon/tempo, 230-260 = threshold, <230 = interval/rep
    if (paceAvg > 310) return "easy";
    if (paceAvg > 260) return "tempo";
    if (paceAvg > 230) return "threshold";
    return "intervals";
  }

  // Fallback: use step type mapping
  const stepTypeToRunType: Record<string, string> = {
    interval: "intervals",
    active: "tempo",
    work: "tempo",
  };
  return stepTypeToRunType[step.type] ?? "easy";
}

export function normalizeStep(raw: RawBackendStep): NormalizedStep {
  const step: NormalizedStep = {
    type: raw.step_type || raw.type || "work",
    name: raw.description || raw.name || raw.step_type || "Step",
  }

  if (raw.target_pace_min != null) step.target_pace_low = raw.target_pace_min
  if (raw.target_pace_max != null) step.target_pace_high = raw.target_pace_max
  if (raw.target_hr_min != null) step.target_hr_low = raw.target_hr_min
  if (raw.target_hr_max != null) step.target_hr_high = raw.target_hr_max

  if (raw.duration_type === "distance" && raw.duration_value != null) {
    step.distance_meters = raw.duration_value
  } else if (raw.duration_type === "time" && raw.duration_value != null) {
    step.duration_minutes = raw.duration_value / 60
  }

  // Pass through already-normalized fields (take precedence)
  if (raw.target_pace_low != null) step.target_pace_low = raw.target_pace_low
  if (raw.target_pace_high != null) step.target_pace_high = raw.target_pace_high
  if (raw.target_hr_low != null) step.target_hr_low = raw.target_hr_low
  if (raw.target_hr_high != null) step.target_hr_high = raw.target_hr_high
  if (raw.distance_meters != null) step.distance_meters = raw.distance_meters
  if (raw.duration_minutes != null) step.duration_minutes = raw.duration_minutes
  if (raw.repeats != null) step.repeats = raw.repeats

  // If no HR targets from DB, derive from step type + pace
  if (step.target_hr_low == null && step.target_hr_high == null) {
    const runType = inferRunType(step);
    const zone = HR_ZONES[runType];
    if (zone) {
      step.target_hr_low = zone.low;
      step.target_hr_high = zone.high;
    }
  }

  return step
}

export function normalizeSteps(rawSteps: RawBackendStep[]): NormalizedStep[] {
  if (!rawSteps || !Array.isArray(rawSteps)) return []
  return rawSteps.map(normalizeStep)
}
