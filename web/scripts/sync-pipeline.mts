/**
 * Soma sync pipeline — TS entrypoint that replaces the Python sync/src/pipeline.py
 * (#187 cutover). Run by the GitHub Actions sync workflow via `npx tsx` on the
 * 30-min schedule (no Vercel involvement → no 300s limit, no daily-cron cap).
 * Composes the same ported lib functions the Vercel crons use; each step is
 * non-fatal so one failure doesn't abort the rest, mirroring pipeline.py.
 */
import { neon } from "@neondatabase/serverless";
import { GarminAuth, DBTokenStore } from "garmin-auth";
import { HevyClient } from "hevy2garmin";
import type { QueryFn } from "../lib/db";
import { runGarminIngest } from "../lib/garmin-ingest";
import { getHevyApiKey, syncAllWorkouts } from "../lib/hevy-ingest";
import { enrichNewWorkouts } from "../lib/hevy-enrich-run";
import { computeHevyLoads } from "../lib/training-load";
import { backfillLoadFromHistory, computeAndStorePmc } from "../lib/pmc-stream";
import { pushPlanToGarmin } from "../lib/garmin-workout-builder";
import { enrichGarminRunActivities } from "../lib/garmin-run-enrich";
import { notifyPendingWorkouts } from "../lib/notify";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) { console.error("[sync] DATABASE_URL not set"); process.exit(1); }
const sql = neon(databaseUrl) as unknown as QueryFn;
const webBaseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.SOMA_WEB_URL || "https://soma.gkos.dev";

async function step(name: string, fn: () => Promise<unknown>): Promise<void> {
  const t0 = Date.now();
  try {
    const r = await fn();
    console.log(`[sync] ${name} OK (${Date.now() - t0}ms):`, JSON.stringify(r));
  } catch (e) {
    console.error(`[sync] ${name} FAILED (${Date.now() - t0}ms):`, (e as Error).message);
  }
}

// 1. Garmin daily + activities + parse + training-engine streams + kite.
await step("garmin-ingest", () => runGarminIngest(databaseUrl!, sql));

// 2. Hevy pull + enrich + training loads + PMC.
await step("hevy", async () => {
  const apiKey = await getHevyApiKey(sql);
  if (!apiKey) throw new Error("Hevy API key not configured");
  const client = new HevyClient(apiKey);
  const pull = await syncAllWorkouts(client, sql);
  const enrich = await enrichNewWorkouts(sql);
  const loadsComputed = await computeHevyLoads(sql);
  const garminLoads = await backfillLoadFromHistory(sql);
  const pmc = await computeAndStorePmc(sql);
  return { pull, enrich, loadsComputed, garminLoads, pmcDays: pmc.length };
});

// 3+4. Garmin client for the external-write steps (plan push + run enrichment).
let garminClient: Awaited<ReturnType<GarminAuth["client"]>> | null = null;
try {
  garminClient = await new GarminAuth({ store: new DBTokenStore(databaseUrl) }).client();
} catch (e) {
  console.error("[sync] Garmin auth for push/enrich failed:", (e as Error).message);
}

if (garminClient) {
  await step("plan-push", async () => {
    const rows = await sql`SELECT id FROM training_plan WHERE status = 'active' LIMIT 1`;
    if (!rows.length) return { activePlan: null, pushed: 0 };
    const planId = Number(rows[0].id);
    return { activePlan: planId, ...(await pushPlanToGarmin(sql, garminClient!, planId)) };
  });
  await step("garmin-enrich", () => enrichGarminRunActivities(sql, garminClient!, webBaseUrl));
}

// 5. Telegram + push notifications for new activities/workouts.
await step("notify", () => notifyPendingWorkouts(sql));

console.log("[sync] pipeline complete");
