import { NextResponse } from "next/server";
import { GarminAuth, DBTokenStore } from "garmin-auth";
import { getDb } from "@/lib/db";
import { createPlan, regenerateWorkoutSteps } from "@/lib/plan-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Training-plan admin endpoint (#187) — the TS home of the old init_plan +
 * regenerate_workout_steps CLI tools. CRON_SECRET-gated (admin only).
 *
 * POST { action: "create", raceDate, raceDistanceKm?, goalTimeSeconds?, vdot?, push? }
 *   Generate a 5-week HM plan, store it, make it the single active plan, and
 *   optionally push its workouts to Garmin now (else the plan-push cron does it).
 * POST { action: "regenerate" }
 *   Rebuild workout_steps on future non-rest days of the active plan and mark
 *   them pending so the plan-push cron re-pushes them.
 */
export async function POST(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    action?: string; raceDate?: string; raceDistanceKm?: number;
    goalTimeSeconds?: number; vdot?: number; push?: boolean;
  };
  const sql = getDb();
  try {
    if (body.action === "regenerate") {
      const result = await regenerateWorkoutSteps(sql);
      return NextResponse.json({ ok: true, ...result });
    }
    if (body.action === "create") {
      if (!body.raceDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.raceDate)) {
        return NextResponse.json({ error: "raceDate (YYYY-MM-DD, a Sunday) required" }, { status: 400 });
      }
      let client = null;
      if (body.push) {
        const databaseUrl = process.env.DATABASE_URL;
        if (!databaseUrl) return NextResponse.json({ error: "DATABASE_URL not set" }, { status: 500 });
        client = await new GarminAuth({ store: new DBTokenStore(databaseUrl) }).client();
      }
      const result = await createPlan(sql, client, {
        raceDate: body.raceDate, raceDistanceKm: body.raceDistanceKm,
        goalTimeSeconds: body.goalTimeSeconds, vdot: body.vdot, push: body.push,
      });
      return NextResponse.json({ ok: true, ...result });
    }
    return NextResponse.json({ error: "action must be 'create' or 'regenerate'" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
