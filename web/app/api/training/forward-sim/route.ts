import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/training/forward-sim
 *
 * Returns all seeds needed for client-side forward simulation:
 * - PMC state (today's CTL, ATL, TSB)
 * - Banister params (personal or default τ1/τ2/k1/k2/p0)
 * - Current readiness composite z-score
 * - Calibration weights
 * - Remaining plan days with workout details
 * - Current weight-adjusted VDOT
 * - Garmin comparison data for charts
 */
export async function GET() {
  const sql = getDb();
  const today = new Date().toISOString().slice(0, 10);

  const [
    pmcRows,
    banisterRows,
    readinessRows,
    calibRows,
    fitnessRows,
    planDays,
    garminLoadRows,
    garminReadinessRows,
    garminVo2Rows,
    garminRaceRows,
  ] = await Promise.all([
    // Current PMC
    sql`SELECT ctl, atl, tsb FROM pmc_daily ORDER BY date DESC LIMIT 1`
      .catch(() => []),
    // Banister params (latest fitted)
    sql`SELECT p0, k1, k2, tau1, tau2, n_anchors, current_vdot, fitted_at::text
        FROM banister_params ORDER BY fitted_at DESC LIMIT 1`
      .catch(() => []),
    // Today's readiness
    sql`SELECT composite_score, traffic_light, flags
        FROM daily_readiness
        WHERE date <= ${today}
        ORDER BY date DESC LIMIT 1`
      .catch(() => []),
    // Calibration state
    sql`SELECT phase, data_days, weights, force_equal
        FROM calibration_state ORDER BY updated_at DESC LIMIT 1`
      .catch(() => []),
    // Latest fitness/VDOT
    sql`SELECT vo2max, vdot_adjusted, weight_kg
        FROM fitness_trajectory WHERE vo2max IS NOT NULL
        ORDER BY date DESC LIMIT 1`
      .catch(() => []),
    // All plan days (past + future for complete trajectory)
    sql`SELECT d.id, d.day_date::text as day_date, d.week_number, d.run_type,
               d.run_title, d.target_distance_km, d.workout_steps,
               d.load_level, d.gym_workout, d.gym_notes, d.completed,
               d.garmin_workout_id, d.garmin_push_status,
               d.actual_distance_km
        FROM training_plan_day d
        JOIN training_plan p ON d.plan_id = p.id
        WHERE p.status = 'active'
        ORDER BY d.day_date`
      .catch(() => []),
    // Garmin 7-day/28-day load for comparison (last 90 days)
    sql`SELECT date::text as date, daily_load, ctl, atl
        FROM pmc_daily
        WHERE date >= CURRENT_DATE - interval '90 days'
        ORDER BY date`
      .catch(() => []),
    // Garmin training readiness for comparison
    sql`SELECT h.date::text as date,
               h.training_readiness_score AS garmin_score,
               r.composite_score AS our_score
        FROM daily_health_summary h
        LEFT JOIN daily_readiness r ON h.date = r.date
        WHERE h.date >= CURRENT_DATE - interval '90 days'
          AND h.training_readiness_score IS NOT NULL
        ORDER BY h.date`
      .catch(() => []),
    // Garmin VO2max + weight for comparison (weight needed for inline VDOT adjustment)
    sql`SELECT date::text as date, vo2max, vdot_adjusted, weight_kg
        FROM fitness_trajectory
        WHERE date >= CURRENT_DATE - interval '90 days'
          AND vo2max IS NOT NULL
        ORDER BY date`
      .catch(() => []),
    // Race predictions for comparison (Daniels from VDOT + Garmin race prediction)
    sql`SELECT date::text as date, race_prediction_seconds, vdot_adjusted, vo2max, weight_kg
        FROM fitness_trajectory
        WHERE date >= CURRENT_DATE - interval '90 days'
          AND vo2max IS NOT NULL
        ORDER BY date`
      .catch(() => []),
  ]);

  const pmc = pmcRows[0] ?? { ctl: 0, atl: 0, tsb: 0 };
  const fitness = fitnessRows[0] ?? { vo2max: 47, vdot_adjusted: 47, weight_kg: 80.5 };
  const banister = banisterRows[0] ?? { p0: 0, k1: 0.05, k2: 0.08, tau1: 42, tau2: 7, n_anchors: 0, current_vdot: 0 };
  const readiness = readinessRows[0] ?? { composite_score: 0, traffic_light: "green", flags: [] };
  const calib = calibRows[0] ?? { phase: 1, data_days: 0, weights: { hrv: 0.25, sleep: 0.25, rhr: 0.25, bb: 0.25 }, force_equal: false };

  // Race-calibrated VDOT from Banister model — no Garmin fallback
  const banisterCurrentVdot = Number(banister.current_vdot) || 0;
  const effectiveVdot = banisterCurrentVdot;

  // Compute EPOC scale factor: plan loads use distance×intensity (0-15 range)
  // but actual loads are EPOC-based (100-500+ range). Scale plan loads to match.
  const INTENSITY: Record<string, number> = {
    easy: 0.6, recovery: 0.5, tempo: 1.0, threshold: 1.0,
    intervals: 1.2, long: 0.8, race: 1.3, rest: 0,
  };
  const recentActualLoads = garminLoadRows
    .map((r: any) => Number(r.daily_load ?? 0))
    .filter((v: number) => v > 0)
    .slice(-30);
  const avgActualLoad = recentActualLoads.length > 0
    ? recentActualLoads.reduce((s: number, v: number) => s + v, 0) / recentActualLoads.length
    : 0;
  const rawPlanLoads = planDays
    .map((d: any) => ((Number(d.target_distance_km) || 0) * (INTENSITY[(d as any).run_type] || 0.6)))
    .filter((v: number) => v > 0);
  const avgRawPlanLoad = rawPlanLoads.length > 0
    ? rawPlanLoads.reduce((s: number, v: number) => s + v, 0) / rawPlanLoads.length
    : 1;
  const epocScaleFactor = avgActualLoad > 0 ? avgActualLoad / avgRawPlanLoad : 1;

  return NextResponse.json({
    today,
    epocScaleFactor,
    pmc: {
      ctl: Number(pmc.ctl),
      atl: Number(pmc.atl),
      tsb: Number(pmc.tsb),
    },
    banister: {
      p0: Number(banister.p0),
      k1: Number(banister.k1),
      k2: Number(banister.k2),
      tau1: Number(banister.tau1),
      tau2: Number(banister.tau2),
      nAnchors: Number(banister.n_anchors ?? 0),
    },
    readiness: {
      compositeZ: Number(readiness.composite_score),
      trafficLight: readiness.traffic_light,
      flags: readiness.flags ?? [],
    },
    calibration: {
      phase: Number(calib.phase),
      dataDays: Number(calib.data_days),
      weights: calib.weights,
      forceEqual: calib.force_equal,
    },
    fitness: {
      vo2max: Number(fitness.vo2max),
      vdotAdjusted: effectiveVdot,
      weightKg: Number(fitness.weight_kg),
      calibrationWeightKg: 80.5,
    },
    planDays: planDays.map((d: any) => ({
      id: d.id,
      dayDate: d.day_date,
      weekNumber: d.week_number,
      runType: d.run_type,
      runTitle: d.run_title,
      targetDistanceKm: Number(d.target_distance_km ?? 0),
      workoutSteps: d.workout_steps,
      loadLevel: d.load_level,
      gymWorkout: d.gym_workout,
      gymNotes: d.gym_notes,
      completed: d.completed,
      garminWorkoutId: d.garmin_workout_id,
      garminPushStatus: d.garmin_push_status,
      actualDistanceKm: d.actual_distance_km ? Number(d.actual_distance_km) : null,
    })),
    comparison: {
      load: garminLoadRows.map((r: any) => ({
        date: r.date,
        dailyLoad: Number(r.daily_load ?? 0),
        ctl: Number(r.ctl ?? 0),
        atl: Number(r.atl ?? 0),
      })),
      readiness: garminReadinessRows.map((r: any) => ({
        date: r.date,
        garminScore: Number(r.garmin_score ?? 0),
        ourScore: Number(r.our_score ?? 0),
      })),
      fitness: (() => {
        const calibWeight = 80.5; // reference weight for VDOT calibration
        let lastWeight: number | null = null;
        return garminVo2Rows.map((r: any) => {
          const vo2 = Number(r.vo2max ?? 0);
          if (r.weight_kg != null) lastWeight = Number(r.weight_kg);
          // Use DB vdot_adjusted if available, otherwise compute from weight
          const vdotAdj = r.vdot_adjusted != null
            ? Number(r.vdot_adjusted)
            : lastWeight ? vo2 * (calibWeight / lastWeight) : vo2;
          return {
            date: r.date,
            garminVo2max: vo2,
            ourVdot: Math.round(vdotAdj * 10) / 10,
          };
        });
      })(),
      racePrediction: (() => {
        const calibWeight = Number(fitness.weight_kg) || 80.5;
        let lastWeight: number | null = null;
        return garminRaceRows.map((r: any) => {
          const vo2 = Number(r.vo2max ?? 0);
          if (r.weight_kg != null) lastWeight = Number(r.weight_kg);
          const vdotAdj = r.vdot_adjusted != null
            ? Number(r.vdot_adjusted)
            : lastWeight ? vo2 * (calibWeight / lastWeight) : vo2;
          return {
            date: r.date,
            garminSeconds: r.race_prediction_seconds ? Number(r.race_prediction_seconds) : null,
            ourVdot: Math.round(vdotAdj * 10) / 10,
          };
        });
      })(),
    },
  });
}
