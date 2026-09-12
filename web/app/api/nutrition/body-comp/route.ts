import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { deficitWindow, windowLabel } from "@/lib/deficit-window";
import { todayAthlete } from "@/lib/athlete-tz";
import { isObservedDay } from "@/lib/observed-day";
import { reconcile, type DayIn, type DaySource } from "@/lib/energy-reconcile";


export async function GET() {
  const sql = getDb();

  const [profileRows, weightRows] = await Promise.all([
    sql`SELECT weight_kg, estimated_bf_pct, target_bf_pct, target_date, daily_deficit, estimated_ffm_kg FROM nutrition_profile WHERE id = 1`,
    sql`SELECT date::text AS date, weight_grams / 1000.0 AS weight_kg FROM weight_log WHERE weight_grams IS NOT NULL ORDER BY date`,
  ]);

  const profile = profileRows[0];
  if (!profile) return NextResponse.json({ error: "No profile" }, { status: 404 });

  const currentBf = Number(profile.estimated_bf_pct) || 23.5;
  const targetBf = Number(profile.target_bf_pct) || 15;
  const targetDate = profile.target_date instanceof Date
    ? profile.target_date.toISOString().slice(0, 10)
    : String(profile.target_date).slice(0, 10);
  const deficit = Number(profile.daily_deficit) || 800;
  const goalDeficit = deficit;
  const ffm = Number(profile.estimated_ffm_kg) || 60.6;

  // Process weight data with 5-day EMA smoothing + pull-forward to last actual
  const weights: { date: string; weight: number; smoothed: number; bf: number; smoothedBf: number }[] = [];
  let ema = 0;
  const alpha = 2 / (5 + 1); // 5-day EMA (more responsive than 7-day)

  for (const row of weightRows) {
    const w = Number(row.weight_kg);
    if (ema === 0) ema = w;
    else ema = alpha * w + (1 - alpha) * ema;

    const fatKg = Math.max(0, w - ffm);
    const bf = (fatKg / w) * 100;
    const smoothedFat = Math.max(0, ema - ffm);
    const smoothedBf = (smoothedFat / ema) * 100;

    weights.push({
      date: String(row.date),
      weight: Math.round(w * 10) / 10,
      smoothed: Math.round(ema * 10) / 10,
      bf: Math.round(bf * 10) / 10,
      smoothedBf: Math.round(smoothedBf * 10) / 10,
    });
  }

  // Pull-forward: blend last 5 smoothed points toward actual values
  // so the smoothed line converges to the last dot
  const pullN = Math.min(5, weights.length);
  for (let i = 0; i < pullN; i++) {
    const idx = weights.length - pullN + i;
    const blend = (i + 1) / pullN; // 0.2, 0.4, 0.6, 0.8, 1.0
    const w = weights[idx];
    const blendedWeight = w.smoothed * (1 - blend) + w.weight * blend;
    const blendedFat = Math.max(0, blendedWeight - ffm);
    const blendedBf = (blendedFat / blendedWeight) * 100;
    w.smoothed = Math.round(blendedWeight * 10) / 10;
    w.smoothedBf = Math.round(blendedBf * 10) / 10;
  }

  // Current state (latest smoothed)
  const latest = weights[weights.length - 1];
  const currentWeight = latest?.smoothed || Number(profile.weight_kg);
  const currentFat = Math.max(0, currentWeight - ffm);
  const latestBf = latest?.bf || currentBf;
  const latestActualWeight = latest?.weight || Number(profile.weight_kg);
  const latestActualBf = latest?.bf || currentBf;

  // Target calculations
  const targetWeight = Math.round((ffm / (1 - targetBf / 100)) * 10) / 10;
  const fatToLose = Math.max(0, currentFat - (targetWeight * targetBf / 100));
  const totalDeficitNeeded = fatToLose * 7700;
  const today = todayAthlete();
  // Use T12:00 to avoid timezone-related off-by-one when parsing date strings
  const daysRemaining = Math.max(1, Math.round((new Date(targetDate + "T12:00").getTime() - new Date(today + "T12:00").getTime()) / 86400000));
  const weeksRemaining = Math.max(1, daysRemaining / 7);
  const weeklyRate = Math.round((fatToLose / weeksRemaining) * 10) / 10;
  const targetDatePassed = targetDate < today;
  const requiredDeficit = targetDatePassed ? 0 : Math.round(totalDeficitNeeded / daysRemaining);

  // Goal line: starts from first nutrition tracking day, loses at deficit/7700 kg/day
  const goalLine: { date: string; weight: number; bf: number }[] = [];
  const firstNutritionDay = await sql`SELECT MIN(date)::text AS d FROM nutrition_day`;
  const dietStartDate = firstNutritionDay[0]?.d || today;
  // Find the weight closest to diet start date
  const dietStartWeight = weights.find(w => w.date >= dietStartDate)?.weight
    || weights[weights.length - 1]?.weight || currentWeight;
  if (dietStartWeight > targetWeight) {
    const startDate = new Date(dietStartDate + "T12:00");
    const dailyLossKg = deficit / 7700;
    const daysToTarget = dailyLossKg > 0 ? Math.ceil((dietStartWeight - targetWeight) / dailyLossKg) : 365;
    const goalEndDate = new Date(startDate);
    goalEndDate.setDate(goalEndDate.getDate() + daysToTarget);
    const startBfVal = Math.round(((Math.max(0, dietStartWeight - ffm)) / dietStartWeight) * 1000) / 10;
    goalLine.push(
      { date: dietStartDate, weight: Math.round(dietStartWeight * 10) / 10, bf: startBfVal },
      { date: goalEndDate.toISOString().slice(0, 10), weight: targetWeight, bf: targetBf },
    );
  }

  // Trend prediction: constrained polynomial (degree 2) on raw weights
  // Captures mild curvature but can't extrapolate wildly
  const trendPrediction: { date: string; weight: number; bf: number }[] = [];
  let trendSlope = 0;
  let trendC2Raw = 0; // unclamped c2 for client slider
  let trendAnchor = 0;
  let trendLastDate = "";
  let trendTargetDate: string | null = null;

  const trendCutoff = new Date(today + "T12:00");
  trendCutoff.setDate(trendCutoff.getDate() - 30);
  const trendWeights = weights.filter(w => new Date(w.date) >= trendCutoff);
  if (trendWeights.length >= 3) {
    const lastDate = new Date(trendWeights[trendWeights.length - 1].date + "T12:00");
    const xs = trendWeights.map(w => (new Date(w.date + "T12:00").getTime() - lastDate.getTime()) / 86400000);
    const ys = trendWeights.map(w => w.weight);
    const n = xs.length;

    // Linear regression first (fallback + slope reference)
    const Sx = xs.reduce((s, x) => s + x, 0);
    const Sy = ys.reduce((s, y) => s + y, 0);
    const Sxy = xs.reduce((s, x, i) => s + x * ys[i], 0);
    const Sx2 = xs.reduce((s, x) => s + x * x, 0);
    const linDenom = n * Sx2 - Sx * Sx;
    const linB = linDenom !== 0 ? (n * Sxy - Sx * Sy) / linDenom : 0;
    trendSlope = linB;

    // Polynomial degree 2: y = c0 + c1*x + c2*x²
    let c2 = 0;
    if (n >= 4) {
      const Sx3 = xs.reduce((s, x) => s + x ** 3, 0);
      const Sx4 = xs.reduce((s, x) => s + x ** 4, 0);
      const Sx2y = xs.reduce((s, x, i) => s + x * x * ys[i], 0);
      const D = n * (Sx2 * Sx4 - Sx3 * Sx3) - Sx * (Sx * Sx4 - Sx3 * Sx2) + Sx2 * (Sx * Sx3 - Sx2 * Sx2);
      if (Math.abs(D) > 1e-10) {
        c2 = (n * (Sx2 * Sx2y - Sx3 * Sxy) - Sx * (Sx * Sx2y - Sxy * Sx2) + Sy * (Sx * Sx3 - Sx2 * Sx2)) / D;
      }
      // Constrain c2: max ±2kg deviation over 100 days → |c2| < 2/10000 = 0.0002
      c2 = Math.max(-0.0002, Math.min(0.0002, c2));
    }

    const anchorWeight = trendWeights[trendWeights.length - 1].smoothed;
    trendAnchor = anchorWeight;
    trendC2Raw = c2;
    trendLastDate = lastDate.toISOString().slice(0, 10);
    const maxProjDays = 365;

    for (let dayNum = 0; dayNum <= maxProjDays; dayNum += 7) {
      const d = new Date(lastDate);
      d.setDate(d.getDate() + dayNum);
      // Polynomial: anchor + linear slope * x + mild curvature * x²
      const predicted = anchorWeight + linB * dayNum + c2 * dayNum * dayNum;
      const predWeight = Math.round(predicted * 10) / 10;
      const predFat = Math.max(0, predWeight - ffm);
      const predBf = Math.round((predFat / Math.max(predWeight, 1)) * 1000) / 10;
      trendPrediction.push({ date: d.toISOString().slice(0, 10), weight: predWeight, bf: predBf });
      // Stop once we hit target weight
      if (predWeight <= targetWeight) break;
    }
    trendTargetDate = trendPrediction.find(p => p.weight <= targetWeight)?.date || null;
  }

  // Burn breakdown per day — stacked bar data. Since soma#891 every day from
  // the first weigh-in on is returned: an observed day (closed by a person, or
  // every slot logged or skipped) carries what was logged; any other day is
  // reconciled against the scale (lib/energy-reconcile), so an auto-closed
  // empty day is an estimate between two weigh-ins, not a zero and not a gap.
  // lib/adaptive-tdee stays on observed days only: an extrapolated day is
  // derived from the scale, and feeding it back into a TDEE fit would be circular.
  const firstWeighIn = weightRows.length ? String((weightRows[0] as Record<string, unknown>).date) : "9999-12-31";
  // Activity per day is aggregated once (a CTE), not four correlated scans of
  // garmin_activity_raw per row: with every day since the first weigh-in in
  // the result that was the whole cost of this route.
  const deficitRows = await sql`
    WITH act AS (
      SELECT (raw_json->>'startTimeLocal')::date AS d,
             SUM((raw_json->>'calories')::float) FILTER (WHERE raw_json->'activityType'->>'typeKey' = 'running') AS run_cal,
             SUM((raw_json->>'distance')::float) FILTER (WHERE raw_json->'activityType'->>'typeKey' = 'running') AS run_dist,
             SUM((raw_json->>'calories')::float) FILTER (WHERE raw_json->'activityType'->>'typeKey' = 'strength_training') AS gym_cal,
             MIN(raw_json->>'activityName') FILTER (WHERE raw_json->'activityType'->>'typeKey' = 'strength_training') AS gym_title
      FROM garmin_activity_raw
      WHERE endpoint_name = 'summary'
      GROUP BY 1
    )
    SELECT n.date::text AS date, n.target_calories, n.actual_calories, n.deficit_used, n.status, n.closed_by,
           h.total_kilocalories AS garmin_burn, h.bmr_kilocalories AS bmr, h.total_steps,
           (
             SELECT COUNT(DISTINCT s)::float / 4
             FROM (
               SELECT m.meal_slot AS s FROM meal_log m WHERE m.date = n.date AND m.calories > 0
               UNION
               SELECT unnest(COALESCE(n.skipped_slots, ARRAY[]::text[]))
             ) u
             WHERE u.s IN ('breakfast', 'lunch', 'dinner', 'pre_sleep')
           ) AS coverage,
           COALESCE(a.run_cal, 0) AS run_cal, COALESCE(a.run_dist, 0) AS run_dist,
           COALESCE(a.gym_cal, 0) AS gym_cal, a.gym_title
,
           (
             SELECT COALESCE((SELECT SUM(m.calories) FROM meal_log m WHERE m.date = n.date), 0)
                  + COALESCE((SELECT SUM(d.calories) FROM drink_log d WHERE d.date = n.date), 0)
           ) AS logged_calories
    FROM nutrition_day n
    LEFT JOIN daily_health_summary h ON h.date = n.date
    LEFT JOIN act a ON a.d = n.date
    WHERE n.actual_calories > 0 OR n.status = 'active' OR n.date >= ${firstWeighIn}::date
    ORDER BY n.date
  `;

  const todayStr = todayAthlete();
  const todayMealRows = await sql`
    SELECT COALESCE(SUM(calories), 0) AS total FROM meal_log WHERE date = ${todayStr}
  `;
  const todayDrinkRows = await sql`
    SELECT COALESCE(SUM(calories), 0) AS total FROM drink_log WHERE date = ${todayStr}
  `;
  const todayConsumed = Number(todayMealRows[0]?.total || 0) + Number(todayDrinkRows[0]?.total || 0);

  // Per-day rows first; the cumulative/goal-pace series is filled afterwards
  // over the CURRENT window only (#728): a day counts when it is observed or
  // reconciled, and a window breaks at a gap of more than seven days. Days
  // outside the window are still returned for the charts, with
  // cumulative/goalPace null, so they render as context, never as a sum.
  const dailyDeficits: {
    date: string; bmr: number; dailyActivity: number; runCal: number; runDistKm: number;
    gymCal: number; gymTitle: string; totalBurn: number; consumed: number;
    deficit: number; cumulative: number | null; goalPace: number | null; closed: boolean; isToday: boolean;
    coverage: number | null; counted: boolean; inWindow: boolean;
    /** observed | partial | extrapolated | unknown, and the weigh-in interval an estimate came from. */
    source: DaySource; intervalStart: string | null; intervalEnd: string | null;
  }[] = [];

  const prepared: {
    date: string; bmr: number; dailyActivity: number; runCal: number; runDistKm: number; gymCal: number;
    gymTitle: string; totalBurn: number; closed: boolean; isToday: boolean; coverage: number | null;
  }[] = [];
  const dayIns: DayIn[] = [];
  for (let i = 0; i < deficitRows.length; i++) {
    const r = deficitRows[i] as Record<string, unknown>;
    const dateStr = String(r.date).slice(0, 10);
    const isClosed = r.status === "closed";
    const isToday = dateStr === todayStr;
    if (dateStr > todayStr) continue; // a planned-ahead day is not history
    const storedTarget = Number(r.target_calories) || 0;

    // Burn breakdown. A day with no plan and no watch reading has no burn,
    // and without a burn there is nothing to reconcile.
    const garminTotal = Number(r.garmin_burn) || 0;
    if (storedTarget === 0 && garminTotal <= 1500 && !isToday) continue;
    const defUsed = Number(r.deficit_used) || goalDeficit;
    const totalBurn = garminTotal > 1500 ? garminTotal : storedTarget + defUsed;
    const bmr = Number(r.bmr) || 0;
    const runCal = Math.round(Number(r.run_cal) || 0);
    const gymCal = Math.round(Number(r.gym_cal) || 0);
    const dailyActivity = Math.max(0, Math.round(totalBurn - bmr - runCal - gymCal));
    const runDistKm = Math.round((Number(r.run_dist) || 0) / 1000 * 10) / 10;
    const gymTitle = String(r.gym_title || "");

    const coverage = typeof r.coverage === "number" ? r.coverage : r.coverage != null ? Number(r.coverage) : null;
    const observed = isObservedDay({
      status: (r.status as string | null) ?? null,
      closedBy: (r.closed_by as "user" | "auto" | null) ?? null,
      coverage,
    });
    // Logged intake: an observed closed day keeps actual_calories (close-day
    // reconciled it); today reads its live logs; anything else its raw logs.
    const loggedKcal = isClosed && observed
      ? Number(r.actual_calories) || 0
      : isToday ? todayConsumed : Number(r.logged_calories) || 0;

    prepared.push({ date: dateStr, bmr: Math.round(bmr), dailyActivity, runCal, runDistKm, gymCal, gymTitle, totalBurn: Math.round(totalBurn), closed: isClosed, isToday, coverage });
    dayIns.push({ date: dateStr, observed, loggedKcal, loggedShare: observed ? 1 : Math.min(1, coverage ?? 0), burn: Math.round(totalBurn) });
  }
  const weighIns = weightRows.map((w: Record<string, unknown>) => ({ date: String(w.date).slice(0, 10), weightKg: Number(w.weight_kg) }));
  const reconciled = reconcile(weighIns, dayIns);
  for (let i = 0; i < prepared.length; i++) {
    const p = prepared[i];
    const o = reconciled[i];
    dailyDeficits.push({
      ...p,
      consumed: Math.round(o.ate),
      deficit: Math.round(o.deficit), // negative = deficit (good)
      cumulative: null,
      goalPace: null,
      counted: o.source !== "unknown",
      inWindow: false,
      source: o.source,
      intervalStart: o.intervalStart,
      intervalEnd: o.intervalEnd,
    });
  }
  // The current window: cumulative and goal pace run over its counted days only.
  const win = deficitWindow(dailyDeficits.map(d => ({ date: d.date, closed: d.closed, coverage: d.coverage, deficit: d.deficit, counted: d.counted })), todayStr);
  let cumulativeDeficit = 0;
  let windowIndex = 0;
  for (const d of dailyDeficits) {
    if (!win.countedDates.has(d.date)) continue;
    d.inWindow = true;
    windowIndex += 1;
    cumulativeDeficit += d.deficit;
    d.cumulative = Math.round(cumulativeDeficit);
    d.goalPace = -(goalDeficit * windowIndex);
  }

  // Deficit stats from dailyDeficits
  // Deficit stats over the window; 0 when no day counts (the UI reads window.active).
  const totalActualDeficit = -win.totalDeficit; // negative = deficit, matching the per-day sign
  const closedDeficitDays = win.countedDays;
  const avgActualDeficit = win.avgDeficit ?? 0;

  // Compute calorie-predicted weight from cumulative deficit
  const firstDeficitDate = win.start;
  let startWeightForPrediction = currentWeight;
  if (firstDeficitDate && weights.length > 0) {
    const match = weights.findLast(w => w.date <= firstDeficitDate);
    if (match) startWeightForPrediction = match.smoothed;
    else if (weights[0]) startWeightForPrediction = weights[0].smoothed;
  }

  const calPredicted: { date: string; weight: number; closed: boolean }[] = dailyDeficits
    .filter(d => d.inWindow && d.cumulative != null)
    .map(d => ({
      date: d.date,
      weight: Math.round((startWeightForPrediction + (d.cumulative as number) / 7700) * 10) / 10, // cumulative is negative for deficit
      closed: d.closed,
    }));

  // On track assessment
  const onTrack = !targetDatePassed && requiredDeficit <= deficit * 1.1; // within 10% of current deficit
  const realisticDate = (() => {
    const days = totalDeficitNeeded / deficit;
    const d = new Date(today);
    d.setDate(d.getDate() + Math.round(days));
    return d.toISOString().slice(0, 10);
  })();

  return NextResponse.json({
    profile: {
      currentWeight,
      currentBf: latestBf,
      latestActualWeight,
      latestActualBf,
      targetWeight,
      targetBf,
      targetDate,
      targetDatePassed,
      deficit,
      ffm,
      fatToLose: Math.round(fatToLose * 10) / 10,
      daysRemaining,
      weeklyRate,
      requiredDeficit,
      onTrack,
      realisticDate,
      trendTargetDate,
      trendAnchor,
      trendLinB: trendSlope,
      trendC2Raw,
      trendLastDate,
      trendSlope: Math.round(trendSlope * 7 * 100) / 100, // kg/week (negative = losing)
      avgActualDeficit,
      closedDeficitDays,
      totalActualDeficit: Math.round(-totalActualDeficit), // positive = total deficit achieved
      // The window every summed number above refers to (#728).
      window: {
        start: win.start,
        end: win.end,
        countedDays: win.countedDays,
        active: win.active,
        label: windowLabel(win),
      },
    },
    weights,
    goalLine,
    trendPrediction,
    calPredicted,
    dailyDeficits,
    goalDeficit,
  });
}
