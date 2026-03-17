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
  const ffm = Number(profile.estimated_ffm_kg) || 60.6;

  // Process weight data with 7-day EMA smoothing
  const weights: { date: string; weight: number; smoothed: number; bf: number }[] = [];
  let ema = 0;
  const alpha = 2 / (7 + 1); // 7-day EMA

  for (const row of weightRows) {
    const w = Number(row.weight_kg);
    if (ema === 0) ema = w;
    else ema = alpha * w + (1 - alpha) * ema;

    // Estimate BF% from weight assuming lean mass stays constant
    const fatKg = Math.max(0, w - ffm);
    const bf = (fatKg / w) * 100;

    weights.push({
      date: String(row.date),
      weight: Math.round(w * 10) / 10,
      smoothed: Math.round(ema * 10) / 10,
      bf: Math.round(bf * 10) / 10,
    });
  }

  // Current state (latest smoothed)
  const latest = weights[weights.length - 1];
  const currentWeight = latest?.smoothed || Number(profile.weight_kg);
  const currentFat = Math.max(0, currentWeight - ffm);
  const latestBf = latest?.bf || currentBf;

  // Target calculations
  const targetWeight = Math.round((ffm / (1 - targetBf / 100)) * 10) / 10;
  const fatToLose = Math.max(0, currentFat - (targetWeight * targetBf / 100));
  const totalDeficitNeeded = fatToLose * 7700;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const daysRemaining = Math.max(1, Math.round((new Date(targetDate).getTime() - new Date(today).getTime()) / 86400000));
  const requiredDeficit = Math.round(totalDeficitNeeded / daysRemaining);

  // Project weight from today to target date
  const projection: { date: string; weight: number; bf: number }[] = [];
  let projWeight = currentWeight;
  const dailyWeightLoss = (deficit * 1) / 7700; // kg per day at current deficit
  const projStart = new Date(today);
  const projEnd = new Date(targetDate);
  projEnd.setDate(projEnd.getDate() + 14); // extend 2 weeks past target

  for (let d = new Date(projStart); d <= projEnd; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10);
    const projFat = Math.max(0, projWeight - ffm);
    const projBf = (projFat / projWeight) * 100;
    projection.push({
      date: dateStr,
      weight: Math.round(projWeight * 10) / 10,
      bf: Math.round(projBf * 10) / 10,
    });
    projWeight = Math.max(ffm * 1.05, projWeight - dailyWeightLoss);
  }

  // On track assessment
  const onTrack = requiredDeficit <= deficit * 1.1; // within 10% of current deficit
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
      targetWeight,
      targetBf,
      targetDate,
      deficit,
      ffm,
      fatToLose: Math.round(fatToLose * 10) / 10,
      daysRemaining,
      requiredDeficit,
      onTrack,
      realisticDate,
    },
    weights,
    projection,
  });
}
