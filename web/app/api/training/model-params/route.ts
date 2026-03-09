import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "edge";

/**
 * GET /api/training/model-params
 *
 * Returns model identification, Banister parameters, calibration state,
 * and trajectory configuration. Handles missing tables gracefully with
 * sensible defaults.
 */
export async function GET() {
  const sql = getDb();

  // Parallel queries with graceful error handling for tables that may not exist
  const [banisterResult, calibResult] = await Promise.allSettled([
    sql`
      SELECT p0, k1, k2, tau1, tau2, n_anchors, fitted_at
      FROM banister_params
      ORDER BY fitted_at DESC
      LIMIT 1
    `,
    sql`
      SELECT phase, data_days, weights, force_equal, updated_at
      FROM calibration_state
      ORDER BY updated_at DESC
      LIMIT 1
    `,
  ]);

  // Extract Banister params or use defaults
  const banisterRow =
    banisterResult.status === "fulfilled" && banisterResult.value.length > 0
      ? banisterResult.value[0]
      : null;

  const banister = {
    p0: banisterRow ? Number(banisterRow.p0) : 45.0,
    k1: banisterRow ? Number(banisterRow.k1) : 0.05,
    k2: banisterRow ? Number(banisterRow.k2) : 0.08,
    tau1: banisterRow ? Number(banisterRow.tau1) : 42,
    tau2: banisterRow ? Number(banisterRow.tau2) : 7,
    anchorCount: banisterRow ? Number(banisterRow.n_anchors) : 0,
    fittedAt: banisterRow?.fitted_at ?? null,
    isDefault: !banisterRow,
  };

  // Extract calibration state or use defaults
  const calibRow =
    calibResult.status === "fulfilled" && calibResult.value.length > 0
      ? calibResult.value[0]
      : null;

  const phaseNames: Record<number, string> = {
    1: "Equal Weights (Dawes 1979)",
    2: "Correlation-Based (|Pearson r|)",
    3: "LASSO Regression",
    4: "Kalman Filter",
  };

  const calibPhase = calibRow ? Number(calibRow.phase) : 1;

  const calibration = {
    phase: calibPhase,
    phaseName: phaseNames[calibPhase] ?? `Phase ${calibPhase}`,
    dataDays: calibRow ? Number(calibRow.data_days) : 0,
    weights: calibRow?.weights ?? { hrv: 0.25, sleep: 0.25, rhr: 0.25, bb: 0.25 },
    forceEqual: calibRow?.force_equal ?? false,
    updatedAt: calibRow?.updated_at ?? null,
    isDefault: !calibRow,
  };

  return NextResponse.json({
    model: {
      name: "Banister Impulse-Response",
      fullName: "Banister Impulse-Response + Composite Readiness",
      description:
        "Two-component model: fitness (positive adaptation) decays slowly via tau1, " +
        "fatigue (negative adaptation) decays quickly via tau2. " +
        "Performance = p0 + k1*fitness - k2*fatigue. " +
        "Readiness modulates daily pace via z-scored biometric signals.",
    },
    banister,
    calibration,
  });
}
