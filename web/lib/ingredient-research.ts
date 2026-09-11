/**
 * T3a — ingredient research (soma#678). Two sources, one shape, no LLM:
 *   usda: the local `usda_foods` table (USDA FoodData Central foundation + SR legacy
 *         rows, per 100 g, full-text indexed) — soma's own table, searched here.
 *   off:  Open Food Facts, searched by macro-engine-core (re-exported below).
 * The proposal shape, the picker categories and the macro sanity flags live in
 * macro-engine-core too, so every consumer judges a candidate the same way.
 * An unknown macro stays null — never 0.
 */
import type { QueryFn } from "./db";
import { num, sanityFlags, type Proposal } from "macro-engine-core/ingredient-research";

export { CATEGORIES, SHRINK_BY_CATEGORY, sanityFlags, searchOpenFoodFacts } from "macro-engine-core/ingredient-research";
export type { Proposal } from "macro-engine-core/ingredient-research";

const USDA_CONF: Record<string, number> = { foundation: 0.9, sr_legacy: 0.85, survey_fndds: 0.7, branded: 0.6 };

export async function searchUsda(sql: QueryFn, query: string, limit = 8): Promise<Proposal[]> {
  let rows = (await sql`
    SELECT fdc_id, description, brand_owner, data_type, calories, protein, carbs, fat, fiber,
           ts_rank(search_vector, plainto_tsquery('english', ${query})) AS rank
    FROM usda_foods
    WHERE search_vector @@ plainto_tsquery('english', ${query})
    ORDER BY rank DESC, length(description) ASC
    LIMIT ${limit}`) as Record<string, unknown>[];
  if (rows.length === 0) {
    rows = (await sql`
      SELECT fdc_id, description, brand_owner, data_type, calories, protein, carbs, fat, fiber, 0 AS rank
      FROM usda_foods WHERE description ILIKE ${"%" + query + "%"}
      ORDER BY length(description) ASC LIMIT ${limit}`) as Record<string, unknown>[];
  }
  return rows.map((r) => {
    const p = {
      name: String(r.description),
      brand: r.brand_owner ? String(r.brand_owner) : null,
      calories_per_100g: num(r.calories), protein_per_100g: num(r.protein), carbs_per_100g: num(r.carbs),
      fat_per_100g: num(r.fat), fiber_per_100g: num(r.fiber),
    };
    const dt = String(r.data_type ?? "");
    return {
      ...p,
      source: "usda" as const,
      source_id: String(r.fdc_id),
      source_url: `https://fdc.nal.usda.gov/food-details/${r.fdc_id}/nutrients`,
      confidence: USDA_CONF[dt] ?? 0.6,
      rationale: `USDA FoodData Central (${dt.replace("_", " ")}), values per 100 g as published`,
      flags: sanityFlags(p),
    };
  });
}
