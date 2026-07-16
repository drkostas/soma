/**
 * Strava bridge entrypoint — TS port of sync/src/strava_bridge_push.py::main.
 * Runs in GitHub Actions (node + Playwright under xvfb). Forwards recent Garmin
 * activities not yet on Strava through the facterino account, then finalizes each
 * on the Strava web edit page (title/description/image).
 *
 * DRY RUN by default (BRIDGE_LIVE!=1): finds + prepares everything but does NOT
 * upload to facterino or touch Strava. Set BRIDGE_LIVE=1 to fire for real.
 *
 * Dedup (never a duplicate on Strava): findMissed excludes anything in the
 * strava_bridge_uploads ledger or the stored Strava external_ids; the ledger row
 * is written the moment the forward is seen, BEFORE the finalize.
 */
import { chromium } from "playwright";
import { Pool } from "pg";
import { findMissed, lookbackStart, type GarminActivitySummary } from "./dedup";
import { mainGarminClient, getActivitiesByDate, getActivity, downloadFit } from "./garmin";
import { parseGarthDump, serializeGarthDump, isOauth2Expired, refreshOauth2, uploadFit } from "./facterino";
import { stravaCreds, loadSession, saveSession, sessionValid, login, ownActivityIds, setActivityDetails } from "./strava-web";

const FORWARD_POLL_MS = 15_000;
const FORWARD_TRIES = 48; // ~12 min for Garmin→Strava forward
const SOMA = process.env.SOMA_WEB_URL || process.env.SOMA_BASE_URL || "https://soma.gkos.dev";

async function facterinoAccessToken(db: Pool): Promise<string> {
  const r = await db.query(
    "SELECT credentials->>'garth_dump' AS d FROM platform_credentials WHERE platform='garmin_facterino_bridge' AND status='active'",
  );
  const dump = r.rows[0]?.d;
  if (!dump) throw new Error("facterino garth_dump missing");
  const bundle = parseGarthDump(dump);
  if (isOauth2Expired(bundle.oauth2)) {
    bundle.oauth2 = await refreshOauth2(bundle.oauth1);
    await db.query("UPDATE platform_credentials SET credentials = $1 WHERE platform='garmin_facterino_bridge'",
      [JSON.stringify({ garth_dump: serializeGarthDump(bundle) })]);
  }
  return bundle.oauth2.access_token;
}

/** Recent Garmin activities not yet on Strava. */
async function missed(db: Pool, activities: GarminActivitySummary[]): Promise<GarminActivitySummary[]> {
  await db.query(
    "CREATE TABLE IF NOT EXISTS strava_bridge_uploads (garmin_activity_id BIGINT PRIMARY KEY, strava_activity_id BIGINT, uploaded_at TIMESTAMPTZ DEFAULT NOW())",
  );
  const bridged = new Set<number>((await db.query("SELECT garmin_activity_id FROM strava_bridge_uploads")).rows.map((r: any) => Number(r.garmin_activity_id)));
  const extRows = await db.query("SELECT raw_json->>'external_id' AS e FROM strava_raw_data WHERE jsonb_typeof(raw_json)='object' AND raw_json->>'external_id' IS NOT NULL");
  const externalIdsJoined = extRows.rows.map((r: any) => r.e).filter(Boolean).join(" ");
  return findMissed(activities, bridged, externalIdsJoined);
}

async function imagePathFor(db: Pool, gid: number): Promise<string | null> {
  const r = await db.query("SELECT hevy_id FROM workout_enrichment WHERE garmin_activity_id=$1 ORDER BY processed_at DESC LIMIT 1", [gid]);
  const url = r.rows[0]?.hevy_id ? `${SOMA}/api/workout/${r.rows[0].hevy_id}/image` : `${SOMA}/api/activity/${gid}/image`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const path = `/tmp/bridge_${gid}.png`;
    await require("node:fs/promises").writeFile(path, Buffer.from(await resp.arrayBuffer()));
    return path;
  } catch { return null; }
}

async function recordUpload(db: Pool, gid: number, sid: number): Promise<void> {
  await db.query(
    "INSERT INTO strava_bridge_uploads VALUES ($1,$2,NOW()) ON CONFLICT (garmin_activity_id) DO UPDATE SET strava_activity_id=EXCLUDED.strava_activity_id, uploaded_at=NOW()",
    [gid, sid],
  );
}

async function main(): Promise<void> {
  const live = process.env.BRIDGE_LIVE === "1";
  const databaseUrl = process.env.DATABASE_URL!;
  const db = new Pool({ connectionString: databaseUrl });

  const garmin = await mainGarminClient(databaseUrl);
  const start = lookbackStart();
  const today = new Date().toISOString().slice(0, 10);
  const acts = await getActivitiesByDate(garmin, start, today);
  const toPush = await missed(db, acts);

  if (!toPush.length) { console.log("RESULT: nothing to push (all recent activities on Strava)"); await db.end(); return; }
  console.log(`bridge: ${toPush.length} to push: ${toPush.map((a) => a.activityId).join(", ")} (live=${live})`);

  if (!live) {
    console.log("RESULT: DRY RUN — would push:", toPush.map((a) => `${a.activityName || "Workout"}(${a.activityId})`).join(" ;; "));
    await db.end();
    return;
  }

  const { email, password } = stravaCreds();
  if (!email || !password) { console.log("RESULT: ISSUES: Strava web not configured"); await db.end(); return; }

  const token = await facterinoAccessToken(db);
  const browser = await chromium.launch({ headless: false, channel: process.env.STRAVA_WEB_CHANNEL || undefined });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 1000 } });
  const page = await ctx.newPage();

  let authed = false;
  const stored = await loadSession(db);
  if (stored) { try { await ctx.addCookies(stored); authed = await sessionValid(page); } catch { authed = false; } }
  if (!authed) {
    try { await login(page, email, password); authed = true; try { await saveSession(db, await ctx.cookies()); } catch { /* ignore */ } }
    catch (e) { console.log(`RESULT: ISSUES: Strava login failed: ${(e as Error).message.slice(0, 60)}`); await browser.close(); await db.end(); return; }
  }

  const pushed: string[] = [], issues: string[] = [];
  for (const a of toPush) {
    const gid = a.activityId;
    let name = a.activityName || "Workout";
    try {
      const summary = await getActivity(garmin, gid);
      const desc = String(summary.description || "");
      const img = await imagePathFor(db, gid);
      const fit = await downloadFit(garmin, gid);
      const before = await ownActivityIds(page);
      await uploadFit(token, fit, `bridge_${gid}.fit`); // facterino forwards to Strava
      let newId: string | null = null;
      for (let i = 0; i < FORWARD_TRIES; i++) {
        await new Promise((r) => setTimeout(r, FORWARD_POLL_MS));
        let diff: string[] = [];
        try { diff = [...(await ownActivityIds(page))].filter((id) => !before.has(id)); } catch { continue; }
        if (diff.length) { newId = diff.sort((x, y) => Number(x) - Number(y)).at(-1)!; break; }
      }
      if (!newId) { issues.push(`${name}: forward not seen in ${(FORWARD_TRIES * FORWARD_POLL_MS) / 60000}min`); continue; }
      await recordUpload(db, gid, Number(newId)); // record BEFORE finalize → never a duplicate
      await setActivityDetails(page, Number(newId), { title: name, description: desc, imagePath: img, replacePhoto: true });
      pushed.push(`${name}->strava/${newId}`);
      console.log(`pushed ${name} (${gid}) -> strava/${newId}`);
    } catch (e) { issues.push(`${name}: ${(e as Error).message.slice(0, 60)}`); }
  }
  await browser.close();
  await db.end();

  const parts: string[] = [];
  if (pushed.length) parts.push("PUSHED: " + pushed.join(" ;; "));
  if (issues.length) parts.push("ISSUES: " + issues.join(" ;; "));
  console.log("RESULT: " + (parts.length ? parts.join(" | ") : "nothing to push"));
}

main().catch((e) => { console.error("bridge failed:", e); process.exit(1); });
