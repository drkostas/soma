import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { notifyPendingWorkouts } from "@/lib/notify";

// web-push + pngjs need Node APIs.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Notification cron (#186, soma-core Stage 4). Sends Telegram + push for recent
 * workouts not yet notified, deduped via activity_sync_log so it never double-
 * notifies alongside the Python pipeline. CRON_SECRET-gated.
 */
export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await notifyPendingWorkouts(getDb());
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
