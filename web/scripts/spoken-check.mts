/**
 * Drive the whole spoken path with a real recording, end to end (soma#1085).
 *
 *   cd web && DATABASE_URL=postgresql://gkos@127.0.0.1:5432/verify_soma \
 *     npx tsx scripts/spoken-check.mts /tmp/soma-audio/spoken.wav
 *
 * It stores the audio the way the upload route does, creates a capture carrying it together with a
 * deliberately mis-heard phone transcript, runs the worker, and then checks the four properties this
 * feature is for. The agent really runs, so a full pass takes about a minute.
 *
 * ⚠️ Point DATABASE_URL at verify_soma unless you want this meal in your log.
 */
import { readFileSync } from "node:fs";
import { getDb } from "../lib/db";
import { putMedia, transcriptOf } from "../lib/capture-media";
import { createCapture, getCapture } from "../lib/meal-capture";
import { processCapture, claimForCheck } from "../lib/meal-worker";
import { todayAthlete } from "../lib/athlete-tz";
import type { ResolvedItem } from "../lib/meal-quantity";

const path = process.argv[2] ?? "/tmp/soma-audio/spoken.wav";
const keep = process.argv.includes("--keep");

/** What a phone's recogniser does to Greek food names, which is the reason for all of this. */
const PHONE_HEARD = "I ate a few bites of biscuit glucose and a few more from an ekmek cutie fee plus eight lucumades with honey";

const sql = getDb();
const bytes = readFileSync(path);
const ref = await putMedia(sql, "audio/wav", bytes);
console.log(`stored ${(bytes.length / 1024).toFixed(0)} KB as ${ref}`);

const id = await createCapture(sql, {
  date: todayAthlete(), slot: "pre_sleep", mode: "calibrate",
  text: PHONE_HEARD, image: null, audio: ref, heard: PHONE_HEARD,
});
console.log(`capture ${id} created carrying the recording`);

const claimed = await claimForCheck(sql, id);
if (!claimed) { console.error("could not claim the capture"); process.exit(1); }
const started = Date.now();
await processCapture(sql, claimed);
const cap = await getCapture(sql, id);
console.log(`worker finished in ${((Date.now() - started) / 1000).toFixed(0)}s, status ${cap?.status}\n`);

const items = ((cap?.resolved as { items?: ResolvedItem[] } | null)?.items ?? []);
const said = cap?.messages?.[0]?.text ?? "";
const stored = await transcriptOf(sql, ref);

const fails: string[] = [];
const names = items.map((i) => i.ingredient_id).join(", ");
console.log(`thread now says: "${said}"`);
console.log(`stored transcript: "${stored}"`);
console.log(`items: ${names || "(none)"}\n`);

if (!stored) fails.push("the recording has no stored transcript, so a bad reading could not be re-read");
if (/biscuit glucose|lucumades|cutie fee/i.test(said)) fails.push("the thread still shows the phone's mis-hearing");
if (!/loukoumades/i.test(said)) fails.push("the thread does not name loukoumades");
if (!items.some((i) => /loukoumades/i.test(i.ingredient_id))) fails.push("the meal has no loukoumades in it");
if (!items.length) fails.push("nothing was resolved at all");

if (!keep) {
  await sql`DELETE FROM meal_capture WHERE id = ${id}`;
  await sql`DELETE FROM capture_media WHERE id = ${ref.slice(3)}::uuid`;
  if (cap?.meal_log_id) await sql`DELETE FROM meal_log WHERE id = ${cap.meal_log_id}`;
  console.log("cleaned up");
}

if (fails.length) { for (const f of fails) console.error(`FAIL ${f}`); process.exit(1); }
console.log("PASS all four properties hold");
