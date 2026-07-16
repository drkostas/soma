import { NextResponse } from "next/server";
import { GarminAuth, DBTokenStore } from "garmin-auth";
import { getDb } from "@/lib/db";
import { uploadEnrichedToGarmin } from "@/lib/hevy-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Hevy→Garmin FIT upload (#184 phase 2). NOT scheduled in vercel.json — invoked
 * MANUALLY only. Uploading creates real Garmin activities that forward to Strava,
 * so this defaults to DRY RUN: it reports which workouts would upload (after the
 * dedup) WITHOUT uploading. Pass `?live=1` to actually fire.
 *
 * CRON_SECRET-gated.
 */
export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return NextResponse.json({ error: "DATABASE_URL not set" }, { status: 500 });

  const live = new URL(req.url).searchParams.get("live") === "1";
  const sql = getDb();
  try {
    const client = await new GarminAuth({ store: new DBTokenStore(databaseUrl) }).client();
    const result = await uploadEnrichedToGarmin(sql, client, { dryRun: !live });
    return NextResponse.json({ ok: true, mode: live ? "LIVE" : "dry-run", ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
