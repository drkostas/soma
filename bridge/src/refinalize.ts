/**
 * Re-finalize already-bridged Strava activities — TS port of
 * sync/src/refinalize_strava.py. Re-sets title/description/image via the Strava
 * web session (the same mechanism the bridge uses). For kite sessions bridged
 * before their jumps were extracted (0-jump image + no jump data), it rebuilds
 * the kite title/description from the now-present jump data and re-pushes all
 * three. Runs in GitHub Actions (node + Playwright under xvfb).
 *
 * Run: node dist/refinalize.js <garmin_id> [<garmin_id> ...]   (DRY unless STRAVA creds)
 */
import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { Pool } from "pg";
import { stravaCreds, loadSession, saveSession, sessionValid, login, setActivityDetails } from "./strava-web";
import { kiteActivityName, generateKiteStravaDescription } from "./kite-description";

const SOMA = process.env.SOMA_WEB_URL || process.env.SOMA_BASE_URL || "https://soma.gkos.dev";

async function stravaIdFor(db: Pool, gid: number): Promise<number | null> {
  const r = await db.query("SELECT strava_activity_id FROM strava_bridge_uploads WHERE garmin_activity_id=$1", [gid]);
  return r.rows[0]?.strava_activity_id ? Number(r.rows[0].strava_activity_id) : null;
}
async function summaryFor(db: Pool, gid: number): Promise<any> {
  const r = await db.query("SELECT raw_json FROM garmin_activity_raw WHERE activity_id=$1 AND endpoint_name='summary'", [gid]);
  const j = r.rows[0]?.raw_json;
  return j == null ? {} : (typeof j === "string" ? JSON.parse(j) : j);
}
async function kitePayloadFor(db: Pool, gid: number): Promise<any | null> {
  const r = await db.query("SELECT raw_json FROM garmin_activity_raw WHERE activity_id=$1 AND endpoint_name='kite_jumps'", [gid]);
  const j = r.rows[0]?.raw_json;
  return j == null ? null : (typeof j === "string" ? JSON.parse(j) : j);
}
async function imagePathFor(gid: number): Promise<string | null> {
  try {
    const resp = await fetch(`${SOMA}/api/activity/${gid}/image`);
    if (!resp.ok) return null;
    const path = `/tmp/refinalize_${gid}.png`;
    await writeFile(path, Buffer.from(await resp.arrayBuffer()));
    return path;
  } catch { return null; }
}

async function main(): Promise<void> {
  const ids = process.argv.slice(2).map((s) => parseInt(s, 10)).filter((n) => !isNaN(n));
  if (!ids.length) { console.log("usage: refinalize <garmin_id> ..."); return; }

  const db = new Pool({ connectionString: process.env.DATABASE_URL });

  // Resolve each activity's Strava id + title/description/image up front (this is
  // pure DB + the ported kite/run text + the share image — no Strava writes yet).
  type Job = { gid: number; stravaId: number; title: string; description: string; imagePath: string | null };
  const jobs: Job[] = [];
  for (const gid of ids) {
    const stravaId = await stravaIdFor(db, gid);
    if (!stravaId) { console.log(`  ${gid}: not in strava_bridge_uploads, skipping`); continue; }
    const summary = await summaryFor(db, gid);
    const kite = await kitePayloadFor(db, gid);
    const isKite = kite && (kite.summary?.jump_count || 0) > 0;
    const title = isKite ? kiteActivityName(summary, kite) : (summary.activityName || "Activity");
    const description = isKite ? generateKiteStravaDescription(summary, kite) : String(summary.description || "");
    const imagePath = await imagePathFor(gid);
    jobs.push({ gid, stravaId, title, description, imagePath });
    console.log(`  prepared ${gid} -> strava/${stravaId}: "${title}" (image=${imagePath ? "yes" : "no"})`);
  }
  if (!jobs.length) { console.log("RESULT: nothing to re-finalize"); await db.end(); return; }

  const { email, password } = stravaCreds();
  if (!email || !password) { console.log("RESULT: DRY (no STRAVA_WEB_EMAIL/PASSWORD) — prepared but not pushed"); await db.end(); return; }

  const browser = await chromium.launch({ headless: false, channel: process.env.STRAVA_WEB_CHANNEL || undefined });
  const cookies = await loadSession(db);
  const context = await browser.newContext(cookies ? { storageState: { cookies, origins: [] } } : {});
  const page = await context.newPage();
  try {
    await page.goto("https://www.strava.com/dashboard", { waitUntil: "domcontentloaded" });
    if (!(await sessionValid(page))) { await login(page, email, password); await saveSession(db, await context.cookies()); }

    let done = 0;
    for (const j of jobs) {
      try {
        await setActivityDetails(page, j.stravaId, { title: j.title, description: j.description, imagePath: j.imagePath, replacePhoto: true });
        console.log(`  ${j.gid} -> strava/${j.stravaId}: re-finalized ("${j.title}")`);
        done += 1;
      } catch (e) {
        console.log(`  ${j.gid} -> strava/${j.stravaId}: FAILED — ${(e as Error).message.slice(0, 80)}`);
      }
    }
    console.log(`RESULT: ${done}/${jobs.length} re-finalized`);
  } finally {
    await browser.close();
    await db.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
