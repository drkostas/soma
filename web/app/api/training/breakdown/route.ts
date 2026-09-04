import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Invalid date format" }, { status: 400 });
  }

  const sql = getDb();
  const [readiness] = await sql`
    SELECT traffic_light, composite_score, hrv_z_score, sleep_z_score, rhr_z_score, body_battery_z_score, flags
    FROM daily_readiness WHERE date = ${date}
  `;
  const [pmc] = await sql`
    SELECT ctl, atl, tsb FROM pmc_daily WHERE date = ${date}
  `;
  const [fitness] = await sql`
    SELECT vo2max, decoupling_pct, weight_kg, vdot_adjusted FROM fitness_trajectory WHERE date = ${date}
  `;

  return NextResponse.json({
    date,
    // No row for the date = nothing to score yet: say "unknown", never nothing (#647).
    readiness: readiness || {
      traffic_light: "unknown", composite_score: null, hrv_z_score: null, sleep_z_score: null,
      rhr_z_score: null, body_battery_z_score: null, flags: ["no_data"],
    },
    pmc: pmc || null,
    fitness: fitness || null,
  });
}
