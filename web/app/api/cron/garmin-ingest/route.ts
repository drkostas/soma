import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { runGarminIngest } from "@/lib/garmin-ingest";

// pg + garmin-auth need Node APIs — NOT edge. Long-running Garmin fan-out.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Garmin ingestion cron (#183, soma-core Stage 1). Pulls the daily + range +
 * activity endpoints for every stale date and upserts garmin_raw_data /
 * garmin_activity_raw. Idempotent, so it runs safely alongside the Python sync.
 *
 * Protected by CRON_SECRET (Vercel cron sends `Authorization: Bearer <secret>`).
 * Invoke manually to verify prod parity before wiring the schedule in vercel.json.
 */
export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return NextResponse.json({ error: "DATABASE_URL not set" }, { status: 500 });
  }
  try {
    const result = await runGarminIngest(databaseUrl, getDb());
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
