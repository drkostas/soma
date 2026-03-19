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

  // Project weight from last data point to target date
  const projection: { date: string; weight: number; weightHigh: number; weightLow: number; bf: number }[] = [];
  const lastDataDate = weights.length > 0 ? weights[weights.length - 1].date : today;
  const projStart = new Date(lastDataDate);
  let projWeight = weights.length > 0 ? weights[weights.length - 1].smoothed : currentWeight;
  const dailyWeightLoss = (deficit * 1) / 7700; // kg per day at current deficit
  const projEnd = new Date(targetDate);
  projEnd.setDate(projEnd.getDate() + 7); // small buffer past target

  for (let d = new Date(projStart); d <= projEnd; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10);
    // Clamp at target weight
    if (projWeight <= targetWeight) projWeight = targetWeight;
    const projFat = Math.max(0, projWeight - ffm);
    const projBf = Math.max(targetBf, (projFat / projWeight) * 100);
    projection.push({
      date: dateStr,
      weight: Math.round(projWeight * 10) / 10,
      weightHigh: Math.round((projWeight + 1) * 10) / 10,
      weightLow: Math.round((projWeight - 1) * 10) / 10,
      bf: Math.round(projBf * 10) / 10,
    });
    projWeight = Math.max(targetWeight, projWeight - dailyWeightLoss);
  }

  // Cumulative deficit data — use Garmin actual burn when available
  const deficitRows = await sql`
    SELECT n.date::text AS date, n.target_calories, n.actual_calories, n.deficit_used, n.status, n.manual_override,
           h.total_kilocalories AS garmin_burn
    FROM nutrition_day n
    LEFT JOIN daily_health_summary h ON h.date = n.date
    WHERE n.actual_calories > 0 OR n.status = 'active'
    ORDER BY n.date
  `;

  // Get Hevy gym calories per day (not included in Garmin total)
  const gymCalRows = await sql`
    SELECT workout_date::text AS date, COALESCE(SUM(calories), 0) AS gym_cal
    FROM workout_enrichment
    WHERE workout_date >= (SELECT MIN(date) FROM nutrition_day)
    GROUP BY workout_date
  `;
  const gymCalByDate: Record<string, number> = {};
  for (const r of gymCalRows) gymCalByDate[String(r.date).slice(0, 10)] = Number(r.gym_cal) || 0;

  const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const todayMealRows = await sql`
    SELECT COALESCE(SUM(calories), 0) AS total FROM meal_log WHERE date = ${todayStr}
  `;
  const todayDrinkRows = await sql`
    SELECT COALESCE(SUM(calories), 0) AS total FROM drink_log WHERE date = ${todayStr}
  `;
  const todayConsumed = Number(todayMealRows[0]?.total || 0) + Number(todayDrinkRows[0]?.total || 0);

  let cumulativeActual = 0;
  let cumulativeExpected = 0;
  const deficitTrend: { date: string; actual: number; expected: number; closed: boolean }[] = [];

  for (const r of deficitRows) {
    const dateStr = String(r.date).slice(0, 10);
    const isClosed = r.status === "closed";
    const isToday = dateStr === todayStr;

    // Expected: goalDeficit per day
    cumulativeExpected += goalDeficit;

    // Actual burn: prefer Garmin total_kilocalories (already includes uploaded Hevy workouts)
    // Fall back to estimate (target + deficit_used) when Garmin data is missing/stale
    const garminBurn = Number(r.garmin_burn) || 0;
    const storedTarget = Number(r.target_calories) || 0;
    const defUsed = Number(r.deficit_used) || goalDeficit;
    const estimatedBurn = storedTarget + defUsed;
    // Use Garmin burn if it looks complete (BMR > 1500 implies full day)
    // Note: Garmin total already includes gym (FIT files uploaded by sync)
    const actualBurn = garminBurn > 1500 ? garminBurn : estimatedBurn;

    // Skip empty future days with no real data (target=0 produces fake deficits)
    if (storedTarget === 0 && !isToday && !isClosed) continue;

    let consumed: number;
    if (isClosed) {
      consumed = Number(r.actual_calories) || 0;
    } else if (isToday) {
      consumed = todayConsumed;
    } else {
      // Unclosed past day — compute consumed from meal_log + drink_log
      const pastMeals = await sql`SELECT COALESCE(SUM(calories), 0) AS total FROM meal_log WHERE date = ${dateStr}`;
      const pastDrinks = await sql`SELECT COALESCE(SUM(calories), 0) AS total FROM drink_log WHERE date = ${dateStr}`;
      consumed = Number(pastMeals[0]?.total || 0) + Number(pastDrinks[0]?.total || 0);
      if (consumed === 0) continue; // truly empty day, skip
    }

    const dailyDeficit = actualBurn - consumed;
    cumulativeActual += dailyDeficit;

    deficitTrend.push({
      date: dateStr,
      actual: Math.round(cumulativeActual),
      expected: Math.round(cumulativeExpected),
      closed: isClosed,
    });
  }

  // Daily deficit data for bar chart with full day details
  // Convention: negative = deficit (good, bars go DOWN), positive = surplus (bad, bars go UP)
  const dailyDeficits: { date: string; daily: number; cumulative: number; closed: boolean; burned: number; consumed: number }[] = [];
  let prevCumulative = 0;
  for (let i = 0; i < deficitTrend.length; i++) {
    const dt = deficitTrend[i];
    const dailyDeficit = dt.actual - prevCumulative; // positive = deficit

    // Get burn and consumed for this day from deficitRows
    const row = deficitRows[i];
    const dateStr = String(row?.date).slice(0, 10);
    const garminBurnDay = Number(row?.garmin_burn) || 0;
    const storedTargetDay = Number(row?.target_calories) || 0;
    const defUsedDay = Number(row?.deficit_used) || goalDeficit;
    const estBurn = storedTargetDay + defUsedDay;
    const dayBurn = garminBurnDay > 1500 ? garminBurnDay : estBurn;
    const isClosed = row?.status === "closed";
    const isToday = dateStr === todayStr;
    let consumed = 0;
    if (isClosed) consumed = Number(row?.actual_calories) || 0;
    else if (isToday) consumed = todayConsumed;

    dailyDeficits.push({
      date: dt.date,
      daily: Math.round(-dailyDeficit),
      cumulative: Math.round(-dt.actual),
      closed: dt.closed,
      burned: Math.round(dayBurn),
      consumed: Math.round(consumed),
    });
    prevCumulative = dt.actual;
  }

  // Compute calorie-predicted weight from cumulative deficit
  const firstDeficitDate = deficitTrend.length > 0 ? deficitTrend[0].date : null;
  let startWeightForPrediction = currentWeight;
  if (firstDeficitDate && weights.length > 0) {
    // Find the LAST weight on or before the first deficit date (closest, not oldest)
    const match = weights.findLast(w => w.date <= firstDeficitDate);
    if (match) startWeightForPrediction = match.smoothed;
    else if (weights[0]) startWeightForPrediction = weights[0].smoothed;
  }

  const calPredicted: { date: string; weight: number; closed: boolean }[] = deficitTrend.map(dt => ({
    date: dt.date,
    weight: Math.round((startWeightForPrediction - dt.actual / 7700) * 10) / 10,
    closed: dt.closed,
  }));

  // Deficit performance stats
  const closedDeficitEntries = deficitTrend.filter(d => d.closed);
  const closedDeficitDays = closedDeficitEntries.length;
  const totalActualDeficit = closedDeficitDays > 0
    ? closedDeficitEntries[closedDeficitEntries.length - 1].actual  // last closed day's cumulative
    : 0;
  const avgActualDeficit = closedDeficitDays > 0 ? Math.round(totalActualDeficit / closedDeficitDays) : 0;

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
      avgActualDeficit,
      closedDeficitDays,
      totalActualDeficit: Math.round(totalActualDeficit),
    },
    weights,
    projection,
    calPredicted,
    dailyDeficits,
    goalDeficit,
  });
}
