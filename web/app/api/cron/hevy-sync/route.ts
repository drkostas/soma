import { NextResponse } from "next/server";
import { HevyClient } from "hevy2garmin";
import { getDb } from "@/lib/db";
import { syncAllWorkouts, getHevyApiKey } from "@/lib/hevy-ingest";
import { enrichNewWorkouts } from "@/lib/hevy-enrich-run";

// HevyClient + enrichment need Node APIs (fetch/pg via garmin-auth downstream).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Hevy sync cron (#184, soma-core Stage 2 phase 1). Pulls Hevy workouts, then
 * enriches them (HR + calories) and matches to existing Garmin activities.
 * SAFE: only writes hevy_raw_data + workout_enrichment (idempotent) — NO Garmin
 * upload. Runs alongside the Python sync. The dedup-gated FIT upload is separate.
 *
 * CRON_SECRET-gated (Vercel sends `Authorization: Bearer <secret>`).
 */
export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const sql = getDb();
  try {
    const apiKey = await getHevyApiKey(sql);
    if (!apiKey) return NextResponse.json({ error: "Hevy API key not configured" }, { status: 500 });
    const client = new HevyClient(apiKey);
    const pull = await syncAllWorkouts(client, sql);
    const enrich = await enrichNewWorkouts(sql);
    return NextResponse.json({ ok: true, pull, enrich });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
