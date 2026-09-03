/**
 * T3a — ingredient research (soma#678). Two sources, one shape, no LLM:
 *   usda: the local `usda_foods` table (USDA FoodData Central foundation + SR legacy
 *         rows, per 100 g, full-text indexed) — no API key needed.
 *   off:  Open Food Facts search (branded/packaged items, per 100 g, community data).
 * Every candidate carries source, source_id, source_url, confidence and flags.
 * An unknown macro stays null — never 0.
 */
import type { QueryFn } from "./db";

export interface Proposal {
  name: string;
  brand?: string | null;
  calories_per_100g: number | null;
  protein_per_100g: number | null;
  carbs_per_100g: number | null;
  fat_per_100g: number | null;
  fiber_per_100g: number | null;
  source: "usda" | "off";
  source_id: string;
  source_url: string;
  confidence: number;
  rationale: string;
  flags: string[];
}

const USDA_CONF: Record<string, number> = { foundation: 0.9, sr_legacy: 0.85, survey_fndds: 0.7, branded: 0.6 };

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** Flags a candidate whose macros don't add up: per-serving values filed as per-100 g, or holes. */
export function sanityFlags(p: { calories_per_100g: number | null; protein_per_100g: number | null; carbs_per_100g: number | null; fat_per_100g: number | null; fiber_per_100g: number | null }): string[] {
  const flags: string[] = [];
  for (const k of ["calories_per_100g", "protein_per_100g", "carbs_per_100g", "fat_per_100g", "fiber_per_100g"] as const) {
    if (p[k] == null) flags.push(`missing:${k.replace("_per_100g", "")}`);
  }
  if (p.calories_per_100g != null && p.protein_per_100g != null && p.carbs_per_100g != null && p.fat_per_100g != null) {
    const est = 4 * p.protein_per_100g + 4 * p.carbs_per_100g + 9 * p.fat_per_100g;
    if (Math.abs(est - p.calories_per_100g) > 0.2 * Math.max(p.calories_per_100g, 20)) flags.push("kcal_macro_mismatch");
  }
  return flags;
}

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

interface OffProduct { code?: string; product_name?: string; brands?: string | string[]; nutriments?: Record<string, unknown> }
const OFF_UA = "soma/1.0 (https://github.com/drkostas/soma; ingredient research)";

/** Open Food Facts: the search-a-licious service first (fast, reliable), the legacy cgi search as fallback (it 503s under load). */
async function offProducts(query: string, limit: number, timeoutMs: number): Promise<OffProduct[]> {
  const fields = "code,product_name,brands,nutriments";
  try {
    const r = await fetch(`https://search.openfoodfacts.org/search?q=${encodeURIComponent(query)}&page_size=${limit}&fields=${fields}`,
      { headers: { "User-Agent": OFF_UA }, signal: AbortSignal.timeout(timeoutMs) });
    if (r.ok) { const d = (await r.json()) as { hits?: OffProduct[] }; if (d.hits?.length) return d.hits; }
  } catch { /* fall through to the legacy endpoint */ }
  const r = await fetch(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=${limit}&fields=${fields}`,
    { headers: { "User-Agent": OFF_UA }, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`Open Food Facts HTTP ${r.status}`);
  return ((await r.json()) as { products?: OffProduct[] }).products ?? [];
}

export async function searchOpenFoodFacts(query: string, limit = 6, timeoutMs = 8000): Promise<Proposal[]> {
  const out: Proposal[] = [];
  for (const pr of await offProducts(query, limit, timeoutMs)) {
    const n = pr.nutriments ?? {};
    const name = (pr.product_name ?? "").trim();
    const kcal = num(n["energy-kcal_100g"]);
    if (!name || !pr.code || kcal == null) continue;   // nameless or kcal-less rows are not candidates
    const brand = Array.isArray(pr.brands) ? pr.brands.filter(Boolean).join(", ") : pr.brands ? String(pr.brands) : null;
    const p = {
      name, brand: brand || null,
      calories_per_100g: kcal, protein_per_100g: num(n["proteins_100g"]), carbs_per_100g: num(n["carbohydrates_100g"]),
      fat_per_100g: num(n["fat_100g"]), fiber_per_100g: num(n["fiber_100g"]),
    };
    const flags = sanityFlags(p);
    const complete = !flags.some((f) => f.startsWith("missing:"));
    out.push({
      ...p,
      source: "off",
      source_id: String(pr.code),
      source_url: `https://world.openfoodfacts.org/product/${pr.code}`,
      confidence: complete ? 0.6 : 0.45,
      rationale: `Open Food Facts${p.brand ? ` (${p.brand})` : ""}, community-entered label data per 100 g`,
      flags,
    });
  }
  return out;
}
