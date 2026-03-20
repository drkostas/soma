import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "edge";

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

  // Process weight data with 7-day EMA smoothing
  const weights: { date: string; weight: number; smoothed: number; bf: number; smoothedBf: number }[] = [];
  let ema = 0;
  const alpha = 2 / (7 + 1); // 7-day EMA

  for (const row of weightRows) {
    const w = Number(row.weight_kg);
    if (ema === 0) ema = w;
    else ema = alpha * w + (1 - alpha) * ema;

    // Estimate BF% from weight assuming lean mass stays constant
    const fatKg = Math.max(0, w - ffm);
    const bf = (fatKg / w) * 100;
    // Smoothed BF% from smoothed weight
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
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  // Use T12:00 to avoid timezone-related off-by-one when parsing date strings
  const daysRemaining = Math.max(1, Math.round((new Date(targetDate + "T12:00").getTime() - new Date(today + "T12:00").getTime()) / 86400000));
  const weeksRemaining = Math.max(1, daysRemaining / 7);
  const weeklyRate = Math.round((fatToLose / weeksRemaining) * 10) / 10;
  const targetDatePassed = targetDate < today;
  const requiredDeficit = targetDatePassed ? 0 : Math.round(totalDeficitNeeded / daysRemaining);

  // Goal line: straight from first RECENT weigh-in to target weight/date
  const goalLine: { date: string; weight: number; bf: number }[] = [];
  const threeMonthsAgoDate = new Date();
  threeMonthsAgoDate.setMonth(threeMonthsAgoDate.getMonth() - 3);
  const recentWeightsForGoal = weights.filter(w => new Date(w.date) >= threeMonthsAgoDate);
  if (recentWeightsForGoal.length > 0) {
    const startWeight = recentWeightsForGoal[0].smoothed;
    const startDate = new Date(recentWeightsForGoal[0].date + "T12:00");
    const endDate = new Date(targetDate + "T12:00");
    const totalDaysGoal = Math.max(1, (endDate.getTime() - startDate.getTime()) / 86400000);
    const dailyDrop = (startWeight - targetWeight) / totalDaysGoal;
    // Sample weekly to keep data sparse
    for (let dayNum = 0; dayNum <= totalDaysGoal + 7; dayNum += 7) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + dayNum);
      const w = Math.max(targetWeight, Math.round((startWeight - dailyDrop * dayNum) * 10) / 10);
      const fat = Math.max(0, w - ffm);
      const bf = Math.max(targetBf, Math.round((fat / w) * 1000) / 10);
      goalLine.push({ date: d.toISOString().slice(0, 10), weight: w, bf });
    }
    // Always include the exact target date
    goalLine.push({ date: targetDate, weight: targetWeight, bf: targetBf });
  }

  // Trend prediction: linear regression on all smoothed weights, project from last point
  const trendPrediction: { date: string; weight: number; bf: number }[] = [];
  let trendSlope = 0;
  let trendTargetDate: string | null = null;

  // Use recent weights only (last 30 calendar days) for trend regression
  const trendCutoff = new Date(today + "T12:00");
  trendCutoff.setDate(trendCutoff.getDate() - 30);
  const trendWeights = weights.filter(w => new Date(w.date) >= trendCutoff);
  if (trendWeights.length >= 3) {
    const lastDate = new Date(trendWeights[trendWeights.length - 1].date + "T12:00");
    const xs = trendWeights.map(w => (new Date(w.date + "T12:00").getTime() - lastDate.getTime()) / 86400000);
    const ys = trendWeights.map(w => w.smoothed);
    const n = xs.length;
    const sumX = xs.reduce((s, x) => s + x, 0);
    const sumY = ys.reduce((s, y) => s + y, 0);
    const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0);
    const sumX2 = xs.reduce((s, x) => s + x * x, 0);
    const denom = n * sumX2 - sumX * sumX;
    const b = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
    const a = (sumY - b * sumX) / n; // weight at day 0 (last data point)
    trendSlope = b;

    // Project forward from last data point, weekly samples
    const projEndDate = new Date(targetDate + "T12:00");
    projEndDate.setDate(projEndDate.getDate() + 7);
    const totalProjDays = Math.round((projEndDate.getTime() - lastDate.getTime()) / 86400000);

    for (let dayNum = 0; dayNum <= totalProjDays; dayNum += 7) {
      const d = new Date(lastDate);
      d.setDate(d.getDate() + dayNum);
      const predicted = a + b * dayNum;
      const predWeight = Math.round(predicted * 10) / 10;
      const predFat = Math.max(0, predWeight - ffm);
      const predBf = Math.round((predFat / Math.max(predWeight, 1)) * 1000) / 10;
      trendPrediction.push({ date: d.toISOString().slice(0, 10), weight: predWeight, bf: predBf });
    }
    trendTargetDate = trendPrediction.find(p => p.weight <= targetWeight)?.date || null;
  }

  // Burn breakdown per day — stacked bar data
  const deficitRows = await sql`
    SELECT n.date::text AS date, n.target_calories, n.actual_calories, n.deficit_used, n.status,
           h.total_kilocalories AS garmin_burn, h.bmr_kilocalories AS bmr, h.total_steps,
           COALESCE((SELECT SUM((raw_json->>'calories')::float) FROM garmin_activity_raw
             WHERE endpoint_name = 'summary' AND raw_json->'activityType'->>'typeKey' = 'running'
             AND (raw_json->>'startTimeLocal')::date = n.date), 0) AS run_cal,
           COALESCE((SELECT SUM((raw_json->>'distance')::float) FROM garmin_activity_raw
             WHERE endpoint_name = 'summary' AND raw_json->'activityType'->>'typeKey' = 'running'
             AND (raw_json->>'startTimeLocal')::date = n.date), 0) AS run_dist,
           COALESCE((SELECT SUM((raw_json->>'calories')::float) FROM garmin_activity_raw
             WHERE endpoint_name = 'summary' AND raw_json->'activityType'->>'typeKey' = 'strength_training'
             AND (raw_json->>'startTimeLocal')::date = n.date), 0) AS gym_cal,
           (SELECT raw_json->>'activityName' FROM garmin_activity_raw
             WHERE endpoint_name = 'summary' AND raw_json->'activityType'->>'typeKey' = 'strength_training'
             AND (raw_json->>'startTimeLocal')::date = n.date LIMIT 1) AS gym_title
    FROM nutrition_day n
    LEFT JOIN daily_health_summary h ON h.date = n.date
    WHERE n.actual_calories > 0 OR n.status = 'active'
    ORDER BY n.date
  `;

  const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const todayMealRows = await sql`
    SELECT COALESCE(SUM(calories), 0) AS total FROM meal_log WHERE date = ${todayStr}
  `;
  const todayDrinkRows = await sql`
    SELECT COALESCE(SUM(calories), 0) AS total FROM drink_log WHERE date = ${todayStr}
  `;
  const todayConsumed = Number(todayMealRows[0]?.total || 0) + Number(todayDrinkRows[0]?.total || 0);

  let cumulativeDeficit = 0;
  const dailyDeficits: {
    date: string; bmr: number; dailyActivity: number; runCal: number; runDistKm: number;
    gymCal: number; gymTitle: string; totalBurn: number; consumed: number;
    deficit: number; cumulative: number; goalPace: number; closed: boolean; isToday: boolean;
  }[] = [];

  for (let i = 0; i < deficitRows.length; i++) {
    const r = deficitRows[i] as Record<string, unknown>;
    const dateStr = String(r.date).slice(0, 10);
    const isClosed = r.status === "closed";
    const isToday = dateStr === todayStr;
    const storedTarget = Number(r.target_calories) || 0;

    if (storedTarget === 0 && !isToday && !isClosed) continue;

    // Burn breakdown
    const garminTotal = Number(r.garmin_burn) || 0;
    const defUsed = Number(r.deficit_used) || goalDeficit;
    const totalBurn = garminTotal > 1500 ? garminTotal : storedTarget + defUsed;
    const bmr = Number(r.bmr) || 0;
    const runCal = Math.round(Number(r.run_cal) || 0);
    const gymCal = Math.round(Number(r.gym_cal) || 0);
    const dailyActivity = Math.max(0, Math.round(totalBurn - bmr - runCal - gymCal));
    const runDistKm = Math.round((Number(r.run_dist) || 0) / 1000 * 10) / 10;
    const gymTitle = String(r.gym_title || "");

    // Consumed
    let consumed: number;
    if (isClosed) {
      consumed = Number(r.actual_calories) || 0;
    } else if (isToday) {
      consumed = todayConsumed;
    } else {
      const pastMeals = await sql`SELECT COALESCE(SUM(calories), 0) AS total FROM meal_log WHERE date = ${dateStr}`;
      const pastDrinks = await sql`SELECT COALESCE(SUM(calories), 0) AS total FROM drink_log WHERE date = ${dateStr}`;
      consumed = Number(pastMeals[0]?.total || 0) + Number(pastDrinks[0]?.total || 0);
      if (consumed === 0) continue;
    }

    const deficit = consumed - totalBurn; // negative = deficit (good)
    cumulativeDeficit += deficit;

    dailyDeficits.push({
      date: dateStr,
      bmr: Math.round(bmr),
      dailyActivity,
      runCal,
      runDistKm,
      gymCal,
      gymTitle,
      totalBurn: Math.round(totalBurn),
      consumed: Math.round(consumed),
      deficit: Math.round(deficit),
      cumulative: Math.round(cumulativeDeficit),
      goalPace: -goalDeficit * dailyDeficits.length, // will fix after push
      closed: isClosed,
      isToday,
    });
    // Fix goalPace for this entry (index-based)
    dailyDeficits[dailyDeficits.length - 1].goalPace = -(goalDeficit * dailyDeficits.length);
  }

  // Deficit stats from dailyDeficits
  const closedEntries = dailyDeficits.filter(d => d.closed);
  const totalActualDeficit = closedEntries.length > 0
    ? closedEntries.reduce((s, d) => s + d.deficit, 0)
    : 0;
  const closedDeficitDays = closedEntries.length;
  const avgActualDeficit = closedDeficitDays > 0 ? Math.round(-totalActualDeficit / closedDeficitDays) : 0;

  // Compute calorie-predicted weight from cumulative deficit
  const firstDeficitDate = dailyDeficits.length > 0 ? dailyDeficits[0].date : null;
  let startWeightForPrediction = currentWeight;
  if (firstDeficitDate && weights.length > 0) {
    const match = weights.findLast(w => w.date <= firstDeficitDate);
    if (match) startWeightForPrediction = match.smoothed;
    else if (weights[0]) startWeightForPrediction = weights[0].smoothed;
  }

  const calPredicted: { date: string; weight: number; closed: boolean }[] = dailyDeficits.map(d => ({
    date: d.date,
    weight: Math.round((startWeightForPrediction + d.cumulative / 7700) * 10) / 10, // cumulative is negative for deficit
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
      trendSlope: Math.round(trendSlope * 7 * 100) / 100, // kg/week (negative = losing)
      avgActualDeficit,
      closedDeficitDays,
      totalActualDeficit: Math.round(-totalActualDeficit), // positive = total deficit achieved
    },
    weights,
    goalLine,
    trendPrediction,
    calPredicted,
    dailyDeficits,
    goalDeficit,
  });
}
