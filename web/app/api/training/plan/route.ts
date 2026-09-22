import { NextResponse } from "next/server";
import { GarminAuth, DBTokenStore } from "garmin-auth";
import { getDb } from "@/lib/db";
import { getPlanLifecycle } from "@/lib/live-plan";
import { createPlan, dropPlan, type GarminDeleter } from "@/lib/plan-admin";
import { todayForRequest } from "@/lib/request-tz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * The plan lifecycle for the Training page and the app (soma#926).
 *
 * GET  → { current, past }: every plan with its state (live, paused, finished,
 *        dropped), sessions done out of planned, and the pushed workouts ahead.
 * POST { action: "drop" }   → drops the current plan; its pushed future workouts
 *        leave the Garmin calendar; the rows stay as history.
 * POST { action: "create", raceDate, raceDistanceKm?, goalTimeSeconds?, name? }
 *      → a new plan from the generator becomes the one current plan; the
 *        previous one reads finished or dropped by its race date. Its workouts
 *        reach the watch through the plan-push step once the plan is live.
 * Auth is the normal session or bearer (proxy.ts); admin/plan stays CRON-gated.
 */
export async function GET(): Promise<Response> {
  const sql = getDb();
  return NextResponse.json(await getPlanLifecycle(sql));
}

async function garminClient(): Promise<GarminDeleter | null> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return null;
  try {
    return await new GarminAuth({ store: new DBTokenStore(databaseUrl) }).client();
  } catch (e) {
    console.error("plan drop: Garmin client unavailable, workouts stay on the calendar:", (e as Error).message);
    return null;
  }
}

export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as {
    action?: string; raceDate?: string; raceDistanceKm?: number; goalTimeSeconds?: number; name?: string;
  };
  const sql = getDb();
  const today = (await todayForRequest());
  try {
    if (body.action === "drop") {
      const { current } = await getPlanLifecycle(sql, today);
      if (!current) return NextResponse.json({ error: "no current plan" }, { status: 404 });
      if (current.state === "dropped") return NextResponse.json({ ok: true, planId: current.id, removed: 0, failed: 0, already: true });
      const client = current.pushedAhead > 0 ? await garminClient() : null;
      const result = await dropPlan(sql, client, current.id, today);
      return NextResponse.json({ ok: true, ...result, garminReached: client != null });
    }
    if (body.action === "create") {
      if (!body.raceDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.raceDate)) {
        return NextResponse.json({ error: "raceDate (YYYY-MM-DD) required" }, { status: 400 });
      }
      if (body.raceDate < today) return NextResponse.json({ error: "raceDate is in the past" }, { status: 400 });
      const result = await createPlan(sql, null, {
        raceDate: body.raceDate, raceDistanceKm: body.raceDistanceKm, goalTimeSeconds: body.goalTimeSeconds, push: false,
        name: typeof body.name === "string" ? body.name.slice(0, 80) : undefined,
      });
      return NextResponse.json({ ok: true, ...result, lifecycle: await getPlanLifecycle(sql, today) });
    }
    return NextResponse.json({ error: "action must be drop or create" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
