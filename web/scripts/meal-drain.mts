/**
 * Drain the meal-capture queue, on its own, often.
 *
 * The agent can only be spawned on this Mac, but the app posts to soma.gkos.dev, so a sentence
 * typed on the phone lands in the database and waits for something here to pick it up. The sync
 * pipeline does that, at minute 7 of each hour, which means a capture from the phone could sit
 * untouched for an hour with nothing to show for it. This script is the same two calls with no
 * other work attached, cheap enough to run every minute from launchd.
 *
 * Prints one line per run so a quiet minute and a broken minute look different in the log.
 */
import { getDb, type QueryFn } from "../lib/db";
import { agentRunsHere, drainCaptures, reviveStalled } from "../lib/meal-worker";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) { console.error("[meal-drain] DATABASE_URL not set"); process.exit(1); }
if (!agentRunsHere()) { console.error("[meal-drain] no agent here, nothing to do"); process.exit(0); }

const sql: QueryFn = getDb();
const started = Date.now();
try {
  const revived = await reviveStalled(sql);
  const drained = await drainCaptures(sql, 5);
  const ms = Date.now() - started;
  // A run that did nothing still prints, so silence in the log means the job did not run.
  console.log(`[meal-drain] revived=${revived} drained=${drained} in ${ms}ms`);
} catch (e) {
  console.error(`[meal-drain] failed: ${(e as Error).message}`);
  process.exit(1);
}
