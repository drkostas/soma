import { NextResponse } from "next/server";
import { GarminAuth, DBTokenStore } from "garmin-auth";
import { getDb } from "@/lib/db";
import { enrichGarminRunActivities } from "@/lib/garmin-run-enrich";

// garmin-auth needs Node APIs (fetch/pg).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Garmin run enrichment cron (#187). For recent Garmin run activities, sets a
 * stats description and uploads the share card image (rendered by
 * /api/activity/{id}/image) to Garmin Connect. Idempotent via the
 * activity_sync_log dest='garmin_image' ledger. This is the single enricher —
 * the Python pipeline's _enrich_garmin_run_activities is disabled to avoid a
 * duplicate-image race. CRON_SECRET-gated.
 */
export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return NextResponse.json({ error: "DATABASE_URL not set" }, { status: 500 });
  const webBaseUrl = process.env.NEXT_PUBLIC_BASE_URL || `https://${process.env.VERCEL_URL}`;
  const sql = getDb();
  try {
    const auth = new GarminAuth({ store: new DBTokenStore(databaseUrl) });
    const client = await auth.client();
    const result = await enrichGarminRunActivities(sql, client, webBaseUrl);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
