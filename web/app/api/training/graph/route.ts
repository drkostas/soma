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
  computeAdjustedPace,
} from "@/lib/training-engine";
import { getBasePace } from "@/lib/vdot-pace-zones";
import { estimateHMSeconds } from "@/lib/vdot-utils";

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
               composite_score, traffic_light, flags, date::text as data_date
        FROM daily_readiness
        WHERE date <= ${date}
        ORDER BY date DESC LIMIT 1
      `.catch(() => []),
      sql`
        SELECT ctl, atl, tsb, daily_load, date::text as data_date
        FROM pmc_daily
        WHERE date <= ${date}
        ORDER BY date DESC LIMIT 1
      `.catch(() => []),
      sql`
        SELECT vo2max, weight_kg, vdot_adjusted, decoupling_pct, efficiency_factor
        FROM fitness_trajectory
        WHERE date <= ${date}
        ORDER BY date DESC
        LIMIT 1
      `.catch(() => []),
      sql`
        SELECT
          (SELECT avg_overnight_hrv FROM daily_health_summary WHERE date <= ${date} AND avg_overnight_hrv IS NOT NULL ORDER BY date DESC LIMIT 1) as avg_overnight_hrv,
          (SELECT body_battery_at_wake FROM daily_health_summary WHERE date <= ${date} AND body_battery_at_wake IS NOT NULL ORDER BY date DESC LIMIT 1) as body_battery_at_wake,
          (SELECT body_battery_max FROM daily_health_summary WHERE date <= ${date} AND body_battery_max IS NOT NULL ORDER BY date DESC LIMIT 1) as body_battery_max,
          (SELECT sleep_time_seconds FROM daily_health_summary WHERE date <= ${date} AND sleep_time_seconds IS NOT NULL ORDER BY date DESC LIMIT 1) as sleep_time_seconds,
          (SELECT resting_heart_rate FROM daily_health_summary WHERE date <= ${date} AND resting_heart_rate IS NOT NULL ORDER BY date DESC LIMIT 1) as resting_heart_rate,
          (SELECT date::text FROM daily_health_summary WHERE date <= ${date} ORDER BY date DESC LIMIT 1) as data_date
      `.catch(() => []),
      sql`
        SELECT phase, data_days, weights, force_equal
        FROM calibration_state
        ORDER BY updated_at DESC
        LIMIT 1
      `.catch(() => []),
    ]);

  // Query Banister params (table may not exist yet)
  let banisterRows: Record<string, unknown>[] = [];
  try {
    banisterRows = await sql`
      SELECT p0, k1, k2, tau1, tau2, n_anchors, current_vdot
      FROM banister_params ORDER BY fitted_at DESC LIMIT 1
    `;
  } catch {
    // banister_params table doesn't exist yet — gracefully skip
  }

  const readiness = readinessRows[0] ?? null;
  const pmc = pmcRows[0] ?? null;
  const fitness = fitnessRows[0] ?? null;
  const health = healthRows[0] ?? null;
  const calib = calibRows[0] ?? null;
  const dataDate = (readiness as any)?.data_date
    ?? (pmc as any)?.data_date
    ?? (health as any)?.data_date
    ?? date;

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

  // Extract VDOT from Banister model — no Garmin fallback
  const banisterVdot = banisterRows[0] ? Number((banisterRows[0] as any).current_vdot) || null : null;
  const vdotAdj = banisterVdot;

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

  // Fetch today's run type from the active training plan
  const todayStr = new Date().toISOString().split("T")[0];
  let todayPlan: Record<string, unknown>[] = [];
  try {
    todayPlan = await sql`
      SELECT d.run_type FROM training_plan_day d
      JOIN training_plan p ON d.plan_id = p.id
      WHERE p.status = 'active' AND d.day_date = ${todayStr}
      LIMIT 1
    `;
  } catch {
    // training_plan tables may not exist yet — gracefully skip
  }
  const runType = (todayPlan[0]?.run_type as string) || "easy";
  const currentVdot = vdotAdj ?? 0;
  const basePace = getBasePace(currentVdot, runType);

  // Base HM pace from VDOT (Daniels equation)
  const baseHmPace = Math.round(estimateHMSeconds(currentVdot) / 21.0975);

  // Compute factors
  const rf = readinessFactorCalc(compositeScore);
  const ff = fatigueFactorCalc(tsb);
  const wf = weightKg != null ? weightKg / 80.5 : 1.0; // calibration weight = 80.5 kg
  const sliderFactor = 1.0; // default
  // Predicted HM pace = base HM pace × merge factors (readiness, fatigue, weight)
  const combinedFactor = rf < 0 ? 1.0 : rf * ff * wf;
  const adjustedPace = rf < 0 ? null : Math.round(baseHmPace * combinedFactor);

  // ─── Build nodes ───────────────────────────────────────────

  const tooltip = (id: string) => {
    const t = getTooltip(id);
    return {
      short: t.short,
      ...(t.formula ? { formula: t.formula } : {}),
      ...(t.source ? { source: t.source } : {}),
    };
  };

  // Helper: compute normalizedValue (0 = neutral, 1 = extreme) per node type
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  const zNorm = (z: number | null) => z != null ? clamp01(Math.abs(z) / 2) : 0;
  const factorNorm = (f: number | null) => f != null ? clamp01(Math.abs(f - 1.0) / 0.05) : 0;

  const nodes: GraphNode[] = [
    // Raw layer — raw values don't have a natural neutral; mirror their z-score activation
    { id: "hrv_raw", column: "raw", label: "HRV", value: hrvRaw, unit: "ms", color: colorForNode("hrv_z", hrvZ), normalizedValue: zNorm(hrvZ), tooltip: { ...tooltip("hrv_raw"), inputs: [] } },
    { id: "sleep_raw", column: "raw", label: "Sleep", value: sleepHours != null ? round(sleepHours, 1) : null, unit: "h", color: colorForNode("sleep_z", sleepZ), normalizedValue: zNorm(sleepZ), tooltip: { ...tooltip("sleep_raw"), inputs: [] } },
    { id: "rhr_raw", column: "raw", label: "RHR", value: rhrRaw, unit: "bpm", color: colorForNode("rhr_z", rhrZ), normalizedValue: zNorm(rhrZ), tooltip: { ...tooltip("rhr_raw"), inputs: [] } },
    { id: "bb_raw", column: "raw", label: "Body Battery", value: bbRaw, unit: "/100", color: colorForNode("bb_z", bbZ), normalizedValue: zNorm(bbZ), tooltip: { ...tooltip("bb_raw"), inputs: [] } },
    { id: "epoc_raw", column: "raw", label: "EPOC", value: epocRaw, unit: "", color: "oklch(0.7 0.05 250)", normalizedValue: 0, tooltip: { ...tooltip("epoc_raw"), inputs: [] } },
    { id: "weight_raw", column: "raw", label: "Weight", value: weightKg != null ? round(weightKg, 1) : null, unit: "kg", color: "oklch(0.7 0.05 250)", normalizedValue: 0, tooltip: { ...tooltip("weight_raw"), inputs: [] } },

    // Stream layer
    { id: "hrv_z", column: "zscore", label: "HRV z", value: hrvZ != null ? round(hrvZ, 2) : null, unit: "z", color: colorForNode("hrv_z", hrvZ), normalizedValue: zNorm(hrvZ), tooltip: { ...tooltip("hrv_z"), inputs: ["hrv_raw"] } },
    { id: "sleep_z", column: "zscore", label: "Sleep z", value: sleepZ != null ? round(sleepZ, 2) : null, unit: "z", color: colorForNode("sleep_z", sleepZ), normalizedValue: zNorm(sleepZ), tooltip: { ...tooltip("sleep_z"), inputs: ["sleep_raw"] } },
    { id: "rhr_z", column: "zscore", label: "RHR z", value: rhrZ != null ? round(rhrZ, 2) : null, unit: "z", color: colorForNode("rhr_z", rhrZ), normalizedValue: zNorm(rhrZ), tooltip: { ...tooltip("rhr_z"), inputs: ["rhr_raw"] } },
    { id: "bb_z", column: "zscore", label: "BB z", value: bbZ != null ? round(bbZ, 2) : null, unit: "z", color: colorForNode("bb_z", bbZ), normalizedValue: zNorm(bbZ), tooltip: { ...tooltip("bb_z"), inputs: ["bb_raw"] } },
    { id: "ctl", column: "pmc", label: "CTL", value: round(ctl, 1), unit: "", color: colorForNode("ctl", ctl), normalizedValue: clamp01(ctl / 100), tooltip: { ...tooltip("ctl"), inputs: ["epoc_raw"] } },
    { id: "atl", column: "pmc", label: "ATL", value: round(atl, 1), unit: "", color: colorForNode("atl", atl), normalizedValue: clamp01(atl / 100), tooltip: { ...tooltip("atl"), inputs: ["epoc_raw"] } },
    { id: "tsb", column: "pmc", label: "TSB", value: round(tsb, 1), unit: "", color: colorForNode("tsb", tsb), normalizedValue: clamp01(Math.abs(tsb) / 30), tooltip: { ...tooltip("tsb"), inputs: ["ctl", "atl"] } },
    { id: "weight_ema", column: "pmc", label: "Weight EMA", value: weightKg != null ? round(weightKg, 1) : null, unit: "kg", color: "oklch(0.7 0.05 250)", normalizedValue: 0, tooltip: { ...tooltip("weight_ema"), inputs: ["weight_raw"] } },

    // Merge layer
    { id: "readiness_factor", column: "merge", label: "Readiness Factor", value: rf < 0 ? null : round(rf, 4), unit: "×", color: colorForNode("readiness_factor", rf < 0 ? null : rf), normalizedValue: rf < 0 ? 1.0 : factorNorm(rf), tooltip: { ...tooltip("readiness_factor"), inputs: ["hrv_z", "sleep_z", "rhr_z", "bb_z"] } },
    { id: "fatigue_factor", column: "merge", label: "Fatigue Factor", value: round(ff, 4), unit: "×", color: colorForNode("fatigue_factor", ff), normalizedValue: factorNorm(ff), tooltip: { ...tooltip("fatigue_factor"), inputs: ["tsb"] } },
    { id: "weight_factor", column: "merge", label: "Weight Factor", value: round(wf, 4), unit: "×", color: colorForNode("weight_factor", wf), normalizedValue: factorNorm(wf), tooltip: { ...tooltip("weight_factor"), inputs: ["weight_ema"] } },
    { id: "slider_factor", column: "merge", label: "Slider", value: sliderFactor, unit: "×", color: "oklch(0.7 0.12 250)", normalizedValue: factorNorm(sliderFactor), tooltip: { ...tooltip("slider_factor"), inputs: [] } },

    // Output layer — output nodes use readiness composite as their activation proxy
    { id: "vdot", column: "merge", label: "VDOT", value: vdotAdj != null ? round(vdotAdj, 1) : null, unit: "", color: colorForNode("vdot", vdotAdj), normalizedValue: clamp01((vdotAdj ?? 0) / 60), tooltip: { ...tooltip("vdot"), inputs: ["weight_ema", "ctl"] } },

    // Output layer
    { id: "adjusted_pace", column: "output", label: "Predicted HM Pace", value: adjustedPace != null ? round(adjustedPace, 0) : null, unit: "s/km", color: adjustedPace != null ? "oklch(0.7 0.15 142)" : "oklch(0.6 0.2 25)", normalizedValue: adjustedPace != null ? clamp01(Math.abs(adjustedPace - baseHmPace) / 30) : 1.0, tooltip: { ...tooltip("adjusted_pace"), inputs: ["vdot", "readiness_factor", "fatigue_factor", "weight_factor", "slider_factor"] } },
  ];

  // ─── Banister parameter nodes ─────────────────────────────

  const bp = banisterRows[0];
  if (bp) {
    nodes.push(
      {
        id: "banister_tau1", column: "pmc", label: `τ1=${Number(bp.tau1).toFixed(0)}d`,
        value: Number(bp.tau1), unit: "days",
        color: "oklch(0.7 0.12 200)", normalizedValue: 0,
        tooltip: { short: "Personal fitness decay: " + Number(bp.tau1).toFixed(0) + " days (population default: 42). Fitted from " + Number(bp.n_anchors) + " anchor runs.", formula: "", source: "Banister 1991", inputs: [] },
      },
      {
        id: "banister_tau2", column: "pmc", label: `τ2=${Number(bp.tau2).toFixed(0)}d`,
        value: Number(bp.tau2), unit: "days",
        color: "oklch(0.7 0.12 200)", normalizedValue: 0,
        tooltip: { short: "Personal fatigue decay: " + Number(bp.tau2).toFixed(0) + " days (population default: 7). Fitted from " + Number(bp.n_anchors) + " anchor runs.", formula: "", source: "Banister 1991", inputs: [] },
      },
      {
        id: "banister_p0", column: "pmc", label: `p₀=${Number(bp.p0).toFixed(1)}`,
        value: Number(bp.p0), unit: "VDOT",
        color: "oklch(0.7 0.12 200)", normalizedValue: 0,
        tooltip: { short: "Baseline VDOT: " + Number(bp.p0).toFixed(1) + " before any training effect.", formula: "", source: "Banister 1991", inputs: [] },
      },
    );
  }

  // ─── Build edges ───────────────────────────────────────────

  const edges: GraphEdge[] = [
    // Raw -> Stream (z-scores): weight = z-score magnitude (0–1)
    { from: "hrv_raw", to: "hrv_z", weight: Math.min(1, Math.abs(hrvZ ?? 0) / 2) || 0.15 },
    { from: "sleep_raw", to: "sleep_z", weight: Math.min(1, Math.abs(sleepZ ?? 0) / 2) || 0.15 },
    { from: "rhr_raw", to: "rhr_z", weight: Math.min(1, Math.abs(rhrZ ?? 0) / 2) || 0.15 },
    { from: "bb_raw", to: "bb_z", weight: Math.min(1, Math.abs(bbZ ?? 0) / 2) || 0.15 },

    // Raw -> Stream (PMC) — faint default
    { from: "epoc_raw", to: "ctl", weight: 0.15 },
    { from: "epoc_raw", to: "atl", weight: 0.15 },

    // Stream -> Stream (TSB = CTL - ATL) — faint default
    { from: "ctl", to: "tsb", weight: 0.15 },
    { from: "atl", to: "tsb", weight: -0.15 },

    // Raw -> Stream (weight EMA) — faint default
    { from: "weight_raw", to: "weight_ema", weight: 0.15 },

    // Stream -> Merge (z-scores -> readiness factor, with calibration weights)
    { from: "hrv_z", to: "readiness_factor", weight: calibWeights.hrv ?? 0.25 },
    { from: "sleep_z", to: "readiness_factor", weight: calibWeights.sleep ?? 0.25 },
    { from: "rhr_z", to: "readiness_factor", weight: calibWeights.rhr ?? 0.25 },
    { from: "bb_z", to: "readiness_factor", weight: calibWeights.bb ?? 0.25 },

    // Stream -> Merge (TSB -> fatigue factor): weight by TSB magnitude
    { from: "tsb", to: "fatigue_factor", weight: Math.min(1, Math.abs(tsb) / 20) || 0.15 },

    // Stream -> Merge (weight EMA -> weight factor) — faint default
    { from: "weight_ema", to: "weight_factor", weight: 0.15 },

    // Merge -> Output (factors -> adjusted pace): weight by factor deviation from 1.0
    { from: "readiness_factor", to: "adjusted_pace", weight: Math.min(1, Math.abs(rf - 1.0) / 0.05) || 0.15 },
    { from: "fatigue_factor", to: "adjusted_pace", weight: Math.min(1, Math.abs(ff - 1.0) / 0.03) || 0.15 },
    { from: "weight_factor", to: "adjusted_pace", weight: Math.min(1, Math.abs(wf - 1.0) / 0.05) || 0.15 },
    { from: "slider_factor", to: "adjusted_pace", weight: 0.15 },

    // VDOT -> Adjusted Pace (VDOT determines base pace via Daniels table)
    { from: "vdot", to: "adjusted_pace", weight: 1.0 },

    // Weight -> VDOT (weight-adjusted VDOT = base * calibration_weight / current_weight)
    { from: "weight_ema", to: "vdot", weight: 0.15 },

    // CTL -> VDOT (Banister: training fitness feeds VDOT projection)
    { from: "ctl", to: "vdot", weight: 0.3 },

    // Slider -> PMC (slider scales training load, shifting CTL/ATL)
    { from: "slider_factor", to: "ctl", weight: 0.15 },
    { from: "slider_factor", to: "atl", weight: 0.15 },
  ];

  // ─── Banister parameter edges ─────────────────────────────

  if (bp) {
    edges.push(
      { from: "banister_tau1", to: "ctl", weight: 1.0 },
      { from: "banister_tau2", to: "atl", weight: 1.0 },
      { from: "banister_p0", to: "vdot", weight: 1.0 },
    );
  }

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
    dataDate,
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
