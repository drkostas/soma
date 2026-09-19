/**
 * A model-free reading of a sentence, for the everyday case where nothing needs judgement.
 *
 * ⛔ THIS PATH SKIPS THE AGENT ENTIRELY, so a confident wrong answer becomes a wrong meal that
 * nothing ever reviewed. It is therefore deliberately timid: names must match exactly, never
 * fuzzily, and every fragment must carry its own amount. Any doubt at all returns null, which
 * costs nothing but the ordinary wait. A low claim rate is fine. A wrong claim is not.
 */
import type { Quantity, ResolvableItem } from "./meal-quantity";

export interface CatalogEntry { id: string; name: string }

const GRAMS = /(\d+(?:\.\d+)?)\s*(?:g|gr|gram|grams)\b/;
const BITES = /(\d+)\s*bites?\b/;
const PORTION = /\b(small|little|moderate|medium|normal|large|big)\b/;
/**
 * A leading count, and ONLY the number plus an optional times sign.
 * The unit word is deliberately not consumed: in "3 eggs" the unit IS the food, so eating it
 * leaves nothing to match. A sentence like "2 slices bread" is therefore refused rather than
 * guessed at, which is the right way round for a path no model reviews.
 */
const LEADING_COUNT = /^(\d+(?:\.\d+)?)\s*(?:x\s*)?/;

/**
 * Words that mean the sentence needs judgement. Hedges ("about", "some"), a total to divide, a
 * meal referred to by name, or a reference to a picture. Each one is a sentence the agent should
 * read, not this.
 */
const NEEDS_JUDGEMENT =
  /\b(whole plate|in total|total|altogether|regular|usual|my|about|around|roughly|approx|approximately|ish|some|a bit|a few|photo|picture|plate of|portion)\b/;

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s.,]/gu, " ").replace(/\s+/g, " ").trim();
}

function portionValue(word: string): "small" | "moderate" | "large" {
  if (word === "small" || word === "little") return "small";
  if (word === "large" || word === "big") return "large";
  return "moderate";
}

/** Exact match only: the slug, the display name, or the name with its bracketed qualifier off. */
function matchFood(text: string, catalog: CatalogEntry[]): CatalogEntry | null {
  const t = text.trim();
  if (!t) return null;
  for (const c of catalog) {
    const slug = c.id.toLowerCase().replace(/_/g, " ");
    const name = normalise(c.name);
    const bare = normalise(c.name.replace(/\(.*?\)/g, ""));
    if (t === slug || t === name || t === bare) return c;
  }
  return null;
}

/**
 * The items, or null when anything at all is uncertain.
 * Null is the normal outcome for an interesting sentence and is not a failure.
 */
export function fastParse(text: string, catalog: CatalogEntry[]): ResolvableItem[] | null {
  const norm = normalise(text);
  if (!norm) return null;
  if (NEEDS_JUDGEMENT.test(norm)) return null;

  const fragments = norm.split(/\s*,\s*|\s+and\s+/).map((f) => f.trim()).filter(Boolean);
  if (!fragments.length) return null;

  const items: ResolvableItem[] = [];
  for (const frag of fragments) {
    let quantity: Quantity | null = null;
    let rest = frag;

    const bites = BITES.exec(frag);
    const grams = GRAMS.exec(frag);
    const portion = PORTION.exec(frag);
    const leading = LEADING_COUNT.exec(frag);

    if (bites) {
      quantity = { kind: "bites", value: Number(bites[1]) };
      // "3 bites of bread" leaves "of bread", and "of" is not part of any food's name.
      rest = frag.replace(BITES, " ").replace(/^\s*of\s+/, " ");
    } else if (grams) {
      quantity = { kind: "grams", value: Number(grams[1]) };
      rest = frag.replace(GRAMS, " ");
    } else if (portion) {
      quantity = { kind: "portion", value: portionValue(portion[1]) };
      rest = frag.replace(PORTION, " ");
    } else if (leading && /^\d/.test(frag)) {
      quantity = { kind: "count", value: Number(leading[1]) };
      rest = frag.replace(LEADING_COUNT, " ");
    }
    if (!quantity) return null;

    const food = matchFood(normalise(rest), catalog);
    if (!food) return null;

    items.push({
      query: frag, ingredient_id: food.id, quantity, note: null,
      source: "catalog", confidence: 1,
    });
  }
  return items.length ? items : null;
}
