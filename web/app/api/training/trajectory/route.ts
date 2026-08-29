import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { projectVdotSeries, DEFAULT_BANISTER, type DailyLoad } from "@/lib/banister-projection";
import { vdotFromHmSeconds } from "@/lib/vdot-utils";

/**
 * Optimal-vs-actual VDOT trajectory for the mobile app. Ports the training
 * page's server-side `getTrajectoryData`: the Banister-projected optimal VDOT
 * curve from the athlete's real loads out to the race date, the actual Garmin
 * VDOT, plus the race date and goal VDOT (for the goal band / race marker).
 * Returns an empty trajectory (200) when the derived tables or an active plan
 * are absent (e.g. the demo DB), so the app falls back to its model-vs-Garmin view.
 */
async function safeQuery<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

export async function GET() {
  const sql = getDb();

  const raceRows = await safeQuery(
    () => sql`SELECT race_date::text AS race_date, goal_time_seconds FROM training_plan WHERE status = 'active' LIMIT 1`,
    [] as Record<string, unknown>[],
  );
  const race = raceRows[0] ?? null;
  if (!race?.race_date) return NextResponse.json({ trajectory: [], raceDate: null, goalVdot: null });
  const raceDate = String(race.race_date);
  const goalVdot = race.goal_time_seconds ? vdotFromHmSeconds(Number(race.goal_time_seconds)) : null;

  const banister = (await safeQuery(
    () => sql`SELECT p0, k1, k2, tau1, tau2, current_vdot FROM banister_params ORDER BY fitted_at DESC LIMIT 1`,
    [] as Record<string, unknown>[],
  ))[0] ?? null;

  const planDays = await safeQuery(
    () => sql`SELECT day_date::text AS day_date, run_type, target_distance_km
              FROM training_plan_day
              WHERE plan_id = (SELECT id FROM training_plan WHERE status = 'active' LIMIT 1)
              ORDER BY day_date`,
    [] as Record<string, unknown>[],
  );

  const [actuals, pmcRows] = await Promise.all([
    safeQuery(() => sql`SELECT date::text AS date, vo2max FROM fitness_trajectory WHERE vo2max IS NOT NULL ORDER BY date`, [] as Record<string, unknown>[]),
    safeQuery(() => sql`SELECT date::text AS date, daily_load FROM pmc_daily ORDER BY date`, [] as Record<string, unknown>[]),
  ]);
  if (actuals.length === 0) return NextResponse.json({ trajectory: [], raceDate, goalVdot });

  const currentVo2 = banister?.current_vdot ? Number(banister.current_vdot) : 0;
  const rawP0 = banister ? Number(banister.p0) : 0;
  const params = banister
    ? {
        p0: rawP0 > 0 ? rawP0 : currentVo2,
        k1: Number(banister.k1) || DEFAULT_BANISTER.k1,
        k2: Number(banister.k2) || DEFAULT_BANISTER.k2,
        tau1: Number(banister.tau1) || DEFAULT_BANISTER.tau1,
        tau2: Number(banister.tau2) || DEFAULT_BANISTER.tau2,
      }
    : { ...DEFAULT_BANISTER, p0: currentVo2 };

  const INTENSITY: Record<string, number> = { easy: 0.6, recovery: 0.5, tempo: 1.0, threshold: 1.0, intervals: 1.2, long: 0.8, race: 1.3, rest: 0 };

  const historicalLoadMap = new Map<string, number>();
  for (const r of pmcRows) {
    const load = Number(r.daily_load) || 0;
    if (load > 0) historicalLoadMap.set(String(r.date), load);
  }
  const recentActual = [...historicalLoadMap.values()].slice(-30).filter((v) => v > 0);
  const avgActual = recentActual.length ? recentActual.reduce((s, v) => s + v, 0) / recentActual.length : 0;
  const rawPlan = planDays.map((d) => (Number(d.target_distance_km) || 0) * (INTENSITY[String(d.run_type)] || 0.6)).filter((v) => v > 0);
  const avgRawPlan = rawPlan.length ? rawPlan.reduce((s, v) => s + v, 0) / rawPlan.length : 1;
  const scale = avgActual > 0 ? avgActual / avgRawPlan : 1;
  const planLoadMap = new Map<string, number>();
  for (const d of planDays) {
    const raw = (Number(d.target_distance_km) || 0) * (INTENSITY[String(d.run_type)] || 0.6);
    if (raw > 0) planLoadMap.set(String(d.day_date), raw * scale);
  }

  const start = new Date(String(actuals[0].date) + "T00:00:00");
  const end = new Date(raceDate + "T00:00:00");
  const lookbackDays = Math.ceil(5 * Math.max(params.tau1, params.tau2));
  const seriesStartMs = start.getTime() - lookbackDays * 86400000;
  const endMs = end.getTime();

  const allLoads: DailyLoad[] = [];
  for (let ms = seriesStartMs; ms <= endMs; ms += 86400000) {
    const dateStr = new Date(ms).toISOString().split("T")[0];
    allLoads.push({ date: dateStr, load: historicalLoadMap.get(dateStr) ?? planLoadMap.get(dateStr) ?? 0 });
  }
  const projected = projectVdotSeries(allLoads, params);
  const optimalMap = new Map<string, number>();
  const firstActual = String(actuals[0].date);
  allLoads.forEach((l, i) => { if (l.date >= firstActual) optimalMap.set(l.date, projected[i]); });
  const actualMap = new Map(actuals.map((a) => [String(a.date), Number(a.vo2max)]));

  const trajectory: { date: string; optimal: number; actual: number | null }[] = [];
  for (let ms = start.getTime(); ms <= endMs; ms += 86400000) {
    const dateStr = new Date(ms).toISOString().split("T")[0];
    trajectory.push({
      date: dateStr,
      optimal: Math.round((optimalMap.get(dateStr) ?? currentVo2) * 10) / 10,
      actual: actualMap.has(dateStr) ? Math.round((actualMap.get(dateStr) as number) * 10) / 10 : null,
    });
  }

  return NextResponse.json({ trajectory, raceDate, goalVdot: goalVdot != null ? Math.round(goalVdot * 10) / 10 : null });
}
