/**
 * Re-send the Telegram activity notification for one or more Garmin activities —
 * TS port of sync/src/resend_telegram.py. One-off corrective tool (the original
 * may have gone out with the wrong label or before jump data existed); re-fetches
 * the now-correct share image and re-sends it with the activity-type caption.
 * Run: cd web && npx tsx scripts/resend-telegram.mts <garmin_id> [<garmin_id> ...]
 */
import { neon } from "@neondatabase/serverless";
import type { QueryFn } from "../lib/db";
import { sendActivityImage } from "../lib/notify-telegram";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) { console.error("DATABASE_URL not set"); process.exit(1); }
const sql = neon(databaseUrl) as unknown as QueryFn;

const ids = process.argv.slice(2).map((s) => s.trim()).filter(Boolean);
if (!ids.length) { console.error("usage: resend-telegram.mts <garmin_id> [<garmin_id> ...]"); process.exit(1); }

let sent = 0;
for (const aid of ids) {
  const rows = await sql`
    SELECT raw_json->'activityType'->>'typeKey' AS type_key,
           raw_json->>'activityName' AS name, raw_json->>'startTimeLocal' AS start_local
    FROM garmin_activity_raw WHERE activity_id = ${aid} AND endpoint_name = 'summary'`;
  if (!rows.length) { console.log(`  ${aid}: no summary row, skipping`); continue; }
  const { type_key: typeKey, name, start_local: startLocal } = rows[0];
  const date = (startLocal || "").slice(0, 10);
  const ok = await sendActivityImage(sql, aid, name || "Activity", date, typeKey);
  console.log(`  ${aid}: ${ok ? "re-sent" : "FAILED"} (${typeKey})`);
  if (ok) sent += 1;
}
console.log(`Done: ${sent}/${ids.length} notifications re-sent.`);
