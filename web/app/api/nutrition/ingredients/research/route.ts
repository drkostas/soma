import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { searchUsda, searchOpenFoodFacts, type Proposal } from "@/lib/ingredient-research";

export const dynamic = "force-dynamic";

/**
 * POST { query } → { query, proposals: [...], warnings: [...] }
 * Researches an ingredient in the local USDA table and Open Food Facts, stores every
 * candidate as an `ingredient_proposals` row (status pending) and returns them ranked.
 * Never writes to `ingredients` — that takes a confirm (soma#678, T3a).
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { query?: string };
  const query = (body.query ?? "").trim();
  if (query.length < 2 || query.length > 80) return NextResponse.json({ error: "query must be 2–80 characters" }, { status: 400 });

  const sql = getDb();
  const warnings: string[] = [];
  const [usda, off] = await Promise.all([
    searchUsda(sql, query).catch((e: Error) => { warnings.push(`usda: ${e.message}`); return [] as Proposal[]; }),
    searchOpenFoodFacts(query).catch((e: Error) => { warnings.push(`off: ${e.message}`); return [] as Proposal[]; }),
  ]);
  const ranked = [...usda, ...off].sort((a, b) => b.confidence - a.confidence);

  const proposals: (Proposal & { id: number })[] = [];
  for (const p of ranked) {
    const rows = (await sql`
      INSERT INTO ingredient_proposals
        (query, name, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, fiber_per_100g,
         source, source_id, source_url, confidence, rationale, flags)
      VALUES (${query}, ${p.brand ? `${p.name} — ${p.brand}` : p.name}, ${p.calories_per_100g}, ${p.protein_per_100g},
              ${p.carbs_per_100g}, ${p.fat_per_100g}, ${p.fiber_per_100g},
              ${p.source}, ${p.source_id}, ${p.source_url}, ${p.confidence}, ${p.rationale}, ${p.flags})
      RETURNING id`) as { id: number }[];
    proposals.push({ ...p, id: rows[0].id });
  }
  return NextResponse.json({ query, proposals, warnings });
}
