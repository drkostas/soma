import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { CATEGORIES, SHRINK_BY_CATEGORY } from "@/lib/ingredient-research";

export const dynamic = "force-dynamic";


interface ConfirmBody {
  proposal_id: number;
  id: string;                       // slug, e.g. kefir_plain
  name?: string;
  category: string;
  shrink_priority?: number;
  is_raw: boolean;
  raw_to_cooked_ratio?: number | null;
  unit?: string; grams_per_unit?: number | null; unit_step?: number | null;
  calories_per_100g?: number; protein_per_100g?: number; carbs_per_100g?: number; fat_per_100g?: number; fiber_per_100g?: number;
  update_existing?: boolean;
}

const macroKeys = ["calories_per_100g", "protein_per_100g", "carbs_per_100g", "fat_per_100g", "fiber_per_100g"] as const;

/**
 * POST → confirms one proposal into `ingredients` (status confirmed). Owner edits win over
 * the proposal. Every per-100 g macro must be a number (an unknown stays a proposal, never a
 * 0 in the catalog); category, is_raw and shrink_priority are explicit — the rebalance route
 * would silently treat a null priority as a fat. An existing slug is refused unless
 * update_existing is set, and the presets that name it are listed either way (soma#678).
 */
export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => ({}))) as Partial<ConfirmBody>;
  const errors: string[] = [];
  if (!b.proposal_id || !Number.isInteger(b.proposal_id)) errors.push("proposal_id required");
  const id = (b.id ?? "").trim();
  if (!/^[a-z0-9][a-z0-9_]{1,59}$/.test(id)) errors.push("id must be a slug: a-z, 0-9, _ (2–60 chars)");
  if (!b.category || !(CATEGORIES as readonly string[]).includes(b.category)) errors.push(`category must be one of ${CATEGORIES.join(", ")}`);
  if (typeof b.is_raw !== "boolean") errors.push("is_raw must be true or false");
  if (errors.length) return NextResponse.json({ error: errors.join("; ") }, { status: 400 });

  const sql = getDb();
  const prop = ((await sql`SELECT * FROM ingredient_proposals WHERE id = ${b.proposal_id!}`) as Record<string, unknown>[])[0];
  if (!prop) return NextResponse.json({ error: "proposal not found" }, { status: 404 });

  const macros: Record<(typeof macroKeys)[number], number> = {} as never;
  for (const k of macroKeys) {
    const v = b[k] ?? (prop[k] as number | null);
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) errors.push(`${k} must be a number ≥ 0 (unknown is not 0 — edit it in)`);
    else macros[k] = v;
  }
  if (errors.length) return NextResponse.json({ error: errors.join("; ") }, { status: 400 });

  const category = b.category!;
  const shrink = Number.isInteger(b.shrink_priority) ? (b.shrink_priority as number) : SHRINK_BY_CATEGORY[category] ?? 2;
  const name = (b.name ?? String(prop.name)).trim().slice(0, 120);
  const unit = (b.unit ?? "g").trim() || "g";

  const existing = ((await sql`SELECT id, name FROM ingredients WHERE id = ${id}`) as { id: string; name: string }[])[0];
  // preset_meals.items is {calories, protein, …, items: [{grams, ingredient_id}]} — the list sits under items->'items'.
  const presetsUsing = (await sql`
    SELECT id, name FROM preset_meals
    WHERE jsonb_typeof(items->'items') = 'array'
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(items->'items') it WHERE it->>'ingredient_id' = ${id})`) as { id: string; name: string }[];
  if (existing && !b.update_existing) {
    return NextResponse.json({ error: `ingredient '${id}' already exists (${existing.name}); pass update_existing to overwrite its macros`, existing, presets_using: presetsUsing }, { status: 409 });
  }

  const rows = (await sql`
    INSERT INTO ingredients
      (id, name, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, fiber_per_100g,
       is_raw, raw_to_cooked_ratio, category, shrink_priority, unit, grams_per_unit, unit_step,
       status, source, source_id, source_url, confidence, research_notes, researched_at, usda_fdc_id)
    VALUES
      (${id}, ${name}, ${macros.calories_per_100g}, ${macros.protein_per_100g}, ${macros.carbs_per_100g}, ${macros.fat_per_100g}, ${macros.fiber_per_100g},
       ${b.is_raw}, ${b.raw_to_cooked_ratio ?? null}, ${category}, ${shrink}, ${unit}, ${b.grams_per_unit ?? null}, ${b.unit_step ?? (unit === "g" ? 0.25 : 1)},
       'confirmed', ${String(prop.source)}, ${prop.source_id as string | null}, ${prop.source_url as string | null}, ${prop.confidence as number | null},
       ${String(prop.rationale ?? "")}, now(), ${prop.source === "usda" && /^\d+$/.test(String(prop.source_id)) ? Number(prop.source_id) : null})
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name, calories_per_100g = EXCLUDED.calories_per_100g, protein_per_100g = EXCLUDED.protein_per_100g,
      carbs_per_100g = EXCLUDED.carbs_per_100g, fat_per_100g = EXCLUDED.fat_per_100g, fiber_per_100g = EXCLUDED.fiber_per_100g,
      is_raw = EXCLUDED.is_raw, raw_to_cooked_ratio = EXCLUDED.raw_to_cooked_ratio, category = EXCLUDED.category,
      shrink_priority = EXCLUDED.shrink_priority, unit = EXCLUDED.unit, grams_per_unit = EXCLUDED.grams_per_unit, unit_step = EXCLUDED.unit_step,
      status = 'confirmed', source = EXCLUDED.source, source_id = EXCLUDED.source_id, source_url = EXCLUDED.source_url,
      confidence = EXCLUDED.confidence, research_notes = EXCLUDED.research_notes, researched_at = now(), usda_fdc_id = EXCLUDED.usda_fdc_id
    RETURNING *`) as Record<string, unknown>[];
  await sql`UPDATE ingredient_proposals SET status = 'confirmed', confirmed_ingredient_id = ${id} WHERE id = ${b.proposal_id!}`;
  return NextResponse.json({ ok: true, ingredient: rows[0], updated_existing: Boolean(existing), presets_using: presetsUsing });
}
