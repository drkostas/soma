/**
 * Walk every way the owner said they would talk to soma about food, and check the property that
 * has to hold for each (soma#1013).
 *
 *   cd web && set -a && . ./.env.local && set +a && \
 *   npx tsx scripts/meal-capture-check.mts             # all cases
 *   npx tsx scripts/meal-capture-check.mts 2 4 6       # only these
 *   npx tsx scripts/meal-capture-check.mts --keep      # leave what it wrote behind
 *
 * It drives the worker in process rather than through the route, so it exercises the same code
 * with no server running. Every case except the fast-path one calls the real agent, so a full run
 * takes several minutes.
 *
 * ⚠️ Point DATABASE_URL at verify_soma unless you actually want these meals in your log.
 *
 * Most of the quality of this feature lives in lib/nutrition-agent-prompt.md, which will keep
 * changing. This is how you find out whether a change to it broke something else.
 */
import { getDb } from "../lib/db";
import { createCapture, getCapture, type CaptureRow } from "../lib/meal-capture";
import { processCapture } from "../lib/meal-worker";
import type { ResolvedItem } from "../lib/meal-quantity";

interface Resolved { items: ResolvedItem[]; weighMethod?: string }
interface Case {
  n: number;
  what: string;
  text: string;
  mode: "log" | "calibrate";
  /** Returns null when the property holds, or a sentence saying what is wrong. */
  check: (cap: CaptureRow) => string | null;
}

const items = (cap: CaptureRow): ResolvedItem[] => ((cap.resolved as Resolved | null)?.items ?? []);
const method = (cap: CaptureRow): string => String((cap.resolved as Resolved | null)?.weighMethod ?? "");
const proposal = (cap: CaptureRow) => cap.proposal as
  { tense?: string; total_grams?: number | null; preset_name?: string | null;
    question?: string | null; items?: Array<{ quantity?: { kind?: string; value?: unknown } }> } | null;
const find = (cap: CaptureRow, id: string) => items(cap).find((i) => i.ingredient_id === id);

const CASES: Case[] = [
  {
    n: 1, what: "foods with no amounts, nothing invented", mode: "calibrate",
    text: "chicken breast with tomatoes baked potatoes oil and rice",
    check: (cap) => {
      const p = proposal(cap);
      if (!p) return "the agent did not run";
      const kinds = (p.items ?? []).map((i) => i.quantity?.kind);
      if (!kinds.length) return "no items";
      if (kinds.some((k) => k !== "unknown")) return `invented a quantity: ${kinds.join(", ")}`;
      if (items(cap).some((i) => i.grams <= 0)) return "an item resolved to zero grams";
      return null;
    },
  },
  {
    n: 2, what: "explicit grams, no model at all", mode: "calibrate",
    text: "200g chicken breast raw, 100g white rice raw",
    check: (cap) => {
      if (cap.proposal != null) return "the agent ran; the fast path should have handled this";
      if (method(cap) !== "weighed") return `weigh_method was ${method(cap)}`;
      if (find(cap, "chicken_breast_raw")?.grams !== 200) return "chicken was not 200g";
      if (find(cap, "white_rice_raw")?.grams !== 100) return "rice was not 100g";
      return null;
    },
  },
  {
    n: 3, what: "a stated total, divided into shares", mode: "calibrate",
    text: "the whole plate was 600g, chicken breast raw and white rice raw",
    check: (cap) => {
      const p = proposal(cap);
      if (p?.total_grams !== 600) return `total_grams was ${p?.total_grams}`;
      const sum = items(cap).reduce((a, i) => a + i.grams, 0);
      if (Math.abs(sum - 600) > 30) return `the grams sum to ${sum}, not 600`;
      return null;
    },
  },
  {
    n: 4, what: "a portion word, read off his own history", mode: "calibrate",
    text: "large plate of white rice raw",
    check: (cap) => {
      const rice = find(cap, "white_rice_raw");
      if (!rice) return "no rice in the result";
      // His own 90th percentile for white_rice_raw is 120g.
      if (Math.abs(rice.grams - 120) > 5) return `rice was ${rice.grams}g, not his large of 120g`;
      return null;
    },
  },
  {
    n: 5, what: "counts, with a part of them excluded", mode: "calibrate",
    text: "5 eggs 3 only whites",
    check: (cap) => {
      const whole = find(cap, "eggs_whole");
      const whites = find(cap, "egg_whites");
      if (!whole || !whites) return "did not split into whole eggs and whites";
      if (whole.grams !== 100) return `whole eggs were ${whole.grams}g, expected 100 for two`;
      if (whites.grams < 90 || whites.grams > 105) return `whites were ${whites.grams}g, expected about 99 for three`;
      return null;
    },
  },
  {
    n: 6, what: "bites", mode: "calibrate",
    text: "3 bites of bread whole wheat",
    check: (cap) => {
      const b = find(cap, "bread_whole_wheat");
      if (!b) return "no bread in the result";
      if (b.grams !== 30) return `bread was ${b.grams}g, expected 30 for three bites of a 30g slice`;
      return null;
    },
  },
  {
    n: 8, what: "past tense, logged without a question", mode: "log",
    text: "I ate a big plate of omelette cherry tomatoes with some olive oil",
    check: (cap) => {
      const p = proposal(cap);
      if (p?.tense !== "eaten") return `tense was ${p?.tense}`;
      if (p?.question) return `it asked instead of answering: ${p.question}`;
      if (cap.status !== "logged") return `status was ${cap.status}`;
      if (cap.meal_log_id == null) return "nothing was written to meal_log";
      return null;
    },
  },
  {
    n: 9, what: "a saved meal by name", mode: "calibrate",
    text: "my regular omelette plate",
    check: (cap) => {
      const p = proposal(cap);
      if (!p?.preset_name) return "no preset was recognised";
      return null;
    },
  },
];

const argv = process.argv.slice(2);
const keep = argv.includes("--keep");
const only = argv.filter((a) => /^\d+$/.test(a)).map(Number);
const chosen = only.length ? CASES.filter((c) => only.includes(c.n)) : CASES;

const sql = getDb();
const made: number[] = [];
let failed = 0;

console.log(`case 7 (a photo) is not automated: it needs a real picture and an eye on the result.\n`);

for (const c of chosen) {
  const t0 = Date.now();
  const id = await createCapture(sql, {
    date: new Date().toISOString().slice(0, 10), slot: "dinner", mode: c.mode, text: c.text, image: null,
  });
  made.push(id);
  const claimed = await getCapture(sql, id);
  if (claimed) await processCapture(sql, { ...claimed, status: "running", attempts: 1 });
  const cap = await getCapture(sql, id);
  const secs = ((Date.now() - t0) / 1000).toFixed(0);

  if (!cap) { console.log(`✗ ${c.n}  ${c.what}  — the capture vanished`); failed++; continue; }
  // The error matters whatever the status: processCapture RETRIES before it fails, so a first
  // failure leaves the row back at 'captured' with the reason in `error`. Reading only the
  // 'failed' status hid the real cause behind eight useless assertion messages.
  if (cap.error) { console.log(`✗ ${c.n}  ${c.what}  (${secs}s) — ${cap.error}`); failed++; continue; }
  const why = c.check(cap);
  if (why) { console.log(`✗ ${c.n}  ${c.what}  (${secs}s) — ${why}`); failed++; }
  else {
    const got = items(cap).map((i) => `${i.ingredient_id} ${i.grams}g`).join(", ");
    console.log(`✓ ${c.n}  ${c.what}  (${secs}s)\n      ${got}`);
  }
}

if (!keep) {
  for (const id of made) {
    const cap = await getCapture(sql, id);
    if (cap?.meal_log_id) await sql`DELETE FROM meal_log WHERE id = ${cap.meal_log_id}`;
    await sql`DELETE FROM meal_capture WHERE id = ${id}`;
  }
  console.log(`\ncleaned up ${made.length} captures. Pass --keep to leave them.`);
}

console.log(`\n${chosen.length - failed} of ${chosen.length} passed.`);
console.log(failed
  ? "A sentence that comes back with a question, or with the wrong number, is a failure of\nlib/nutrition-agent-prompt.md rather than of the person. Tighten it and run this again."
  : "Every property held.");
process.exit(failed ? 1 : 0);
