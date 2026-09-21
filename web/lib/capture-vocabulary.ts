/**
 * The words he actually says about food.
 *
 * Speech recognition destroys exactly the words that matter here, because they are Greek food
 * names: loukoumades, mpiskotogluko, ekmek kataifi, mpifteki. Both the recogniser on the phone and
 * the transcriber on this Mac can be told what to expect, and the answer is sitting in his own log.
 *
 * One list, two uses, so they cannot drift: `contextualStrings` for the on-device pass, and
 * whisper's `initial_prompt` for the real one.
 */
import type { QueryFn } from "./db";

/** How many words to send. Both consumers degrade with a very long list, and the tail is noise. */
export const MAX_WORDS = 120;

/** Words worth hinting even before he has logged them, because they are what he eats. */
export const SEED_WORDS: readonly string[] = [
  "loukoumades", "mpiskotogluko", "ekmek kataifi", "mpifteki", "pastitsio", "horta",
  "tzatziki", "spanakopita", "tiropita", "gyros", "souvlaki", "fasolada", "gemista",
  "keftedes", "moussaka", "galaktoboureko", "bougatsa", "kataifi", "halloumi", "feta",
];

/** A name worth hinting: a real word, not an id, not absurdly long. */
export function usefulWord(name: string): boolean {
  const n = name.trim();
  if (n.length < 3 || n.length > 40) return false;
  // Ids and codes help nobody say anything.
  if (/^[a-z0-9_]+$/.test(n) && n.includes("_")) return false;
  return /[a-zA-Z]/.test(n);
}

/** Tidy a catalogue name into something a recogniser can be told to expect. */
export function cleanWord(name: string): string {
  return name
    // "loukoumades (Greek honey donuts)" is two hints, and the parenthetical is the weaker one.
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The list, most-logged first, deduplicated case-insensitively, with the seeds kept. */
export function buildVocabulary(names: readonly string[], seeds: readonly string[] = SEED_WORDS): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [...seeds, ...names]) {
    const w = cleanWord(raw);
    if (!usefulWord(w)) continue;
    const key = w.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w);
    if (out.length >= MAX_WORDS) break;
  }
  return out;
}

/** His own food words, the ones he logs most first. */
export async function getVocabulary(sql: QueryFn): Promise<string[]> {
  const rows = (await sql`
    WITH used AS (
      SELECT i->>'ingredient_id' AS id, count(*)::int AS n
      FROM meal_log m, jsonb_array_elements(m.items) i
      WHERE m.date >= CURRENT_DATE - INTERVAL '180 days'
      GROUP BY 1
    )
    SELECT ing.name, COALESCE(used.n, 0) AS n
    FROM ingredients ing LEFT JOIN used ON used.id = ing.id
    WHERE ing.status = 'confirmed'
    UNION ALL
    SELECT name, 0 AS n FROM preset_meals
    ORDER BY n DESC, 1`) as Array<{ name: string; n: number }>;
  return buildVocabulary(rows.map((r) => String(r.name ?? "")));
}
