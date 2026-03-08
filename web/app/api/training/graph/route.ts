import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  type GraphNode,
  type GraphEdge,
  type Override,
  type ComputationGraph,
  readinessFactorCalc,
  fatigueFactorCalc,
  colorForNode,
  getTooltip,
  DEFAULT_BASE_PACE,
  computeAdjustedPace,
} from "@/lib/training-engine";

export const runtime = "edge";

/**
 * GET /api/training/graph?date=YYYY-MM-DD
 *
 * Returns the full computation graph for a given date, including:
 * - Raw, stream, merge, and output nodes with values and colors
 * - Edges connecting nodes with weights from calibration state
 * - Hard override checks (sleep < 5h, BB < 25, HRV SWC, majority rule)
 * - Current calibration phase and weights
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") ?? new Date().toISOString().slice(0, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Invalid date format. Use YYYY-MM-DD." }, { status: 400 });
  }

  const sql = getDb();

  // Parallel queries for all data sources
  const [readinessRows, pmcRows, fitnessRows, healthRows, calibRows] =
    await Promise.all([
      sql`
        SELECT hrv_z_score, sleep_z_score, rhr_z_score, body_battery_z_score,
               composite_score, traffic_light, flags
        FROM daily_readiness
        WHERE date = ${date}
      `,
      sql`
        SELECT ctl, atl, tsb, daily_load
        FROM pmc_daily
        WHERE date = ${date}
      `,
      sql`
        SELECT vo2max, weight_kg, vdot_adjusted, decoupling_pct, efficiency_factor
        FROM fitness_trajectory
        WHERE date <= ${date}
        ORDER BY date DESC
        LIMIT 1
      `,
      sql`
        SELECT sleep_time_seconds, resting_heart_rate, body_battery_at_wake,
               avg_overnight_hrv, body_battery_max
        FROM daily_health_summary
        WHERE date = ${date}
      `,
      sql`
        SELECT phase, data_days, weights, force_equal
        FROM calibration_state
        ORDER BY updated_at DESC
        LIMIT 1
      `,
    ]);

  const readiness = readinessRows[0] ?? null;
  const pmc = pmcRows[0] ?? null;
  const fitness = fitnessRows[0] ?? null;
  const health = healthRows[0] ?? null;
  const calib = calibRows[0] ?? null;

  // Extract raw values
  const hrvRaw = health ? Number(health.avg_overnight_hrv) || null : null;
  const sleepSec = health ? Number(health.sleep_time_seconds) || null : null;
  const sleepHours = sleepSec != null ? sleepSec / 3600 : null;
  const rhrRaw = health ? Number(health.resting_heart_rate) || null : null;
  const bbRaw = health ? Number(health.body_battery_at_wake) || null : null;
  const epocRaw = pmc ? Number(pmc.daily_load) || null : null;
  const weightKg = fitness ? Number(fitness.weight_kg) || null : null;

  // Extract z-scores
  const hrvZ = readiness ? Number(readiness.hrv_z_score) ?? null : null;
  const sleepZ = readiness ? Number(readiness.sleep_z_score) ?? null : null;
  const rhrZ = readiness ? Number(readiness.rhr_z_score) ?? null : null;
  const bbZ = readiness ? Number(readiness.body_battery_z_score) ?? null : null;
  const compositeScore = readiness ? Number(readiness.composite_score) ?? 0 : 0;

  // Extract PMC values
  const ctl = pmc ? Number(pmc.ctl) || 0 : 0;
  const atl = pmc ? Number(pmc.atl) || 0 : 0;
  const tsb = pmc ? Number(pmc.tsb) || 0 : 0;

  // Extract fitness values
  const vo2max = fitness ? Number(fitness.vo2max) || null : null;
  const vdotAdj = fitness ? Number(fitness.vdot_adjusted) || null : null;

  // Calibration weights (default equal)
  const calibWeights: Record<string, number> = calib?.weights ?? {
    hrv: 0.25,
    sleep: 0.25,
    rhr: 0.25,
    bb: 0.25,
  };
  const calibPhase = calib ? Number(calib.phase) || 1 : 1;
  const calibDataDays = calib ? Number(calib.data_days) || 0 : 0;
  const calibForceEqual = calib?.force_equal ?? false;

  // Compute factors
  const rf = readinessFactorCalc(compositeScore);
  const ff = fatigueFactorCalc(tsb);
  const wf = weightKg != null ? weightKg / 80.5 : 1.0; // calibration weight = 80.5 kg
  const sliderFactor = 1.0; // default
  const adjustedPace = computeAdjustedPace(
    DEFAULT_BASE_PACE,
    compositeScore,
    tsb,
    wf,
    sliderFactor,
  );

  // ─── Build nodes ───────────────────────────────────────────

  const tooltip = (id: string) => {
    const t = getTooltip(id);
    return {
      short: t.short,
      ...(t.formula ? { formula: t.formula } : {}),
      ...(t.source ? { source: t.source } : {}),
    };
  };

  const nodes: GraphNode[] = [
    // Raw layer
    { id: "hrv_raw", column: "raw", label: "HRV", value: hrvRaw, unit: "ms", color: colorForNode("hrv_z", hrvZ), tooltip: { ...tooltip("hrv_raw"), inputs: [] } },
    { id: "sleep_raw", column: "raw", label: "Sleep", value: sleepHours != null ? round(sleepHours, 1) : null, unit: "h", color: colorForNode("sleep_z", sleepZ), tooltip: { ...tooltip("sleep_raw"), inputs: [] } },
    { id: "rhr_raw", column: "raw", label: "RHR", value: rhrRaw, unit: "bpm", color: colorForNode("rhr_z", rhrZ), tooltip: { ...tooltip("rhr_raw"), inputs: [] } },
    { id: "bb_raw", column: "raw", label: "Body Battery", value: bbRaw, unit: "/100", color: colorForNode("bb_z", bbZ), tooltip: { ...tooltip("bb_raw"), inputs: [] } },
    { id: "epoc_raw", column: "raw", label: "EPOC", value: epocRaw, unit: "", color: "oklch(0.7 0.05 250)", tooltip: { ...tooltip("epoc_raw"), inputs: [] } },
    { id: "weight_raw", column: "raw", label: "Weight", value: weightKg != null ? round(weightKg, 1) : null, unit: "kg", color: "oklch(0.7 0.05 250)", tooltip: { ...tooltip("weight_raw"), inputs: [] } },

    // Stream layer
    { id: "hrv_z", column: "stream", label: "HRV z", value: hrvZ != null ? round(hrvZ, 2) : null, unit: "z", color: colorForNode("hrv_z", hrvZ), tooltip: { ...tooltip("hrv_z"), inputs: ["hrv_raw"] } },
    { id: "sleep_z", column: "stream", label: "Sleep z", value: sleepZ != null ? round(sleepZ, 2) : null, unit: "z", color: colorForNode("sleep_z", sleepZ), tooltip: { ...tooltip("sleep_z"), inputs: ["sleep_raw"] } },
    { id: "rhr_z", column: "stream", label: "RHR z", value: rhrZ != null ? round(rhrZ, 2) : null, unit: "z", color: colorForNode("rhr_z", rhrZ), tooltip: { ...tooltip("rhr_z"), inputs: ["rhr_raw"] } },
    { id: "bb_z", column: "stream", label: "BB z", value: bbZ != null ? round(bbZ, 2) : null, unit: "z", color: colorForNode("bb_z", bbZ), tooltip: { ...tooltip("bb_z"), inputs: ["bb_raw"] } },
    { id: "ctl", column: "stream", label: "CTL", value: round(ctl, 1), unit: "", color: colorForNode("ctl", ctl), tooltip: { ...tooltip("ctl"), inputs: ["epoc_raw"] } },
    { id: "atl", column: "stream", label: "ATL", value: round(atl, 1), unit: "", color: colorForNode("atl", atl), tooltip: { ...tooltip("atl"), inputs: ["epoc_raw"] } },
    { id: "tsb", column: "stream", label: "TSB", value: round(tsb, 1), unit: "", color: colorForNode("tsb", tsb), tooltip: { ...tooltip("tsb"), inputs: ["ctl", "atl"] } },
    { id: "weight_ema", column: "stream", label: "Weight EMA", value: weightKg != null ? round(weightKg, 1) : null, unit: "kg", color: "oklch(0.7 0.05 250)", tooltip: { ...tooltip("weight_ema"), inputs: ["weight_raw"] } },

    // Merge layer
    { id: "readiness_factor", column: "merge", label: "Readiness Factor", value: rf < 0 ? null : round(rf, 4), unit: "x", color: colorForNode("readiness_factor", rf < 0 ? null : rf), tooltip: { ...tooltip("readiness_factor"), inputs: ["hrv_z", "sleep_z", "rhr_z", "bb_z"] } },
    { id: "fatigue_factor", column: "merge", label: "Fatigue Factor", value: round(ff, 4), unit: "x", color: colorForNode("fatigue_factor", ff), tooltip: { ...tooltip("fatigue_factor"), inputs: ["tsb"] } },
    { id: "weight_factor", column: "merge", label: "Weight Factor", value: round(wf, 4), unit: "x", color: colorForNode("weight_factor", wf), tooltip: { ...tooltip("weight_factor"), inputs: ["weight_ema"] } },
    { id: "slider_factor", column: "merge", label: "Slider", value: sliderFactor, unit: "x", color: "oklch(0.7 0.12 250)", tooltip: { ...tooltip("slider_factor"), inputs: [] } },

    // Output layer
    { id: "adjusted_pace", column: "output", label: "Adjusted Pace", value: adjustedPace != null ? round(adjustedPace, 1) : null, unit: "s/km", color: adjustedPace != null ? "oklch(0.7 0.15 142)" : "oklch(0.6 0.2 25)", tooltip: { ...tooltip("adjusted_pace"), inputs: ["readiness_factor", "fatigue_factor", "weight_factor", "slider_factor"] } },
    { id: "vdot", column: "output", label: "VDOT", value: vdotAdj != null ? round(vdotAdj, 1) : vo2max != null ? round(vo2max, 1) : null, unit: "", color: colorForNode("vdot", vdotAdj ?? vo2max), tooltip: { ...tooltip("vdot"), inputs: ["weight_ema"] } },
  ];

  // ─── Build edges ───────────────────────────────────────────

  const edges: GraphEdge[] = [
    // Raw -> Stream (z-scores)
    { from: "hrv_raw", to: "hrv_z", weight: 1.0 },
    { from: "sleep_raw", to: "sleep_z", weight: 1.0 },
    { from: "rhr_raw", to: "rhr_z", weight: 1.0 },
    { from: "bb_raw", to: "bb_z", weight: 1.0 },

    // Raw -> Stream (PMC)
    { from: "epoc_raw", to: "ctl", weight: 1.0 },
    { from: "epoc_raw", to: "atl", weight: 1.0 },

    // Stream -> Stream (TSB = CTL - ATL)
    { from: "ctl", to: "tsb", weight: 1.0 },
    { from: "atl", to: "tsb", weight: -1.0 },

    // Raw -> Stream (weight EMA)
    { from: "weight_raw", to: "weight_ema", weight: 1.0 },

    // Stream -> Merge (z-scores -> readiness factor, with calibration weights)
    { from: "hrv_z", to: "readiness_factor", weight: calibWeights.hrv ?? 0.25 },
    { from: "sleep_z", to: "readiness_factor", weight: calibWeights.sleep ?? 0.25 },
    { from: "rhr_z", to: "readiness_factor", weight: calibWeights.rhr ?? 0.25 },
    { from: "bb_z", to: "readiness_factor", weight: calibWeights.bb ?? 0.25 },

    // Stream -> Merge (TSB -> fatigue factor)
    { from: "tsb", to: "fatigue_factor", weight: 1.0 },

    // Stream -> Merge (weight EMA -> weight factor)
    { from: "weight_ema", to: "weight_factor", weight: 1.0 },

    // Merge -> Output (all factors -> adjusted pace)
    { from: "readiness_factor", to: "adjusted_pace", weight: 1.0 },
    { from: "fatigue_factor", to: "adjusted_pace", weight: 1.0 },
    { from: "weight_factor", to: "adjusted_pace", weight: 1.0 },
    { from: "slider_factor", to: "adjusted_pace", weight: 1.0 },

    // Weight -> VDOT
    { from: "weight_ema", to: "vdot", weight: 1.0 },
  ];

  // ─── Build overrides ──────────────────────────────────────

  const flags: string[] = readiness?.flags ?? [];
  const overrides: Override[] = [
    {
      rule: "sleep_under_5h",
      triggered: sleepHours != null && sleepHours < 5.0,
      message: `Sleep under 5 hours (${sleepHours != null ? sleepHours.toFixed(1) : "?"}h) — forced RED.`,
      severity: "red",
    },
    {
      rule: "body_battery_critical",
      triggered: bbRaw != null && bbRaw < 25,
      message: `Body Battery at wake < 25 (${bbRaw ?? "?"}) — forced RED.`,
      severity: "red",
    },
    {
      rule: "hrv_below_swc",
      triggered: flags.includes("hrv_below_swc"),
      message: "HRV dropped below smallest worthwhile change (z < -0.5).",
      severity: "yellow",
    },
    {
      rule: "majority_3_of_4",
      triggered: flags.includes("3_of_4_flagged"),
      message: "3 of 4 readiness signals flagged (z < -1) — forced RED.",
      severity: "red",
    },
    {
      rule: "majority_2_of_4",
      triggered: flags.includes("2_of_4_flagged"),
      message: "2 of 4 readiness signals flagged (z < -1) — YELLOW.",
      severity: "yellow",
    },
  ];

  // ─── Assemble response ────────────────────────────────────

  const graph: ComputationGraph = { nodes, edges, overrides };

  return NextResponse.json({
    date,
    graph,
    calibration: {
      phase: calibPhase,
      dataDays: calibDataDays,
      weights: calibWeights,
      forceEqual: calibForceEqual,
    },
  });
}

// ─── Helpers ──────────────────────────────────────────────

function round(v: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(v * factor) / factor;
}
