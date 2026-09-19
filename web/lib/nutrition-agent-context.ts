/**
 * Everything about this owner, handed to the agent on every call.
 *
 * It is a few thousand tokens and it is the reason most sentences finish without a tool call. The
 * three portion columns are what let "large" mean 208g of chicken without anyone being asked.
 */
import type { QueryFn } from "./db";
import { getPortionBands } from "./portion-history";

export interface ContextIngredient {
  id: string; name: string; category: string;
  unit: string | null; grams_per_unit: number | null;
  small: number; usual: number; large: number; n: number;
}
export interface ContextPreset {
  id: string; name: string; slot: string;
  calories: number; protein: number; carbs: number; fat: number; fiber: number;
}
export interface AgentContext {
  date: string; slot: string; weightKg: number | null;
  slotBudgetKcal: number; dayRemainingKcal: number;
  presets: ContextPreset[];
  ingredients: ContextIngredient[];
}

export async function buildAgentContext(
  sql: QueryFn, date: string, slot: string, slotBudgetKcal: number, dayRemainingKcal: number,
): Promise<AgentContext> {
  const bands = await getPortionBands(sql);

  const ingRows = (await sql`
    SELECT id, name, category, unit, grams_per_unit
    FROM ingredients WHERE status = 'confirmed' ORDER BY category, name`) as Array<Record<string, unknown>>;

  const presetRows = (await sql`
    SELECT id::text AS id, name, meal_slot,
           total_calories, total_protein, total_carbs, total_fat, total_fiber
    FROM preset_meals ORDER BY name`) as Array<Record<string, unknown>>;

  const weightRows = (await sql`
    SELECT weight_grams / 1000.0 AS kg FROM weight_log
    WHERE weight_grams > 0 ORDER BY date DESC LIMIT 1`) as Array<{ kg: number }>;

  return {
    date, slot, slotBudgetKcal, dayRemainingKcal,
    weightKg: weightRows.length ? Number(weightRows[0].kg) : null,
    presets: presetRows.map((p) => ({
      id: String(p.id), name: String(p.name), slot: String(p.meal_slot ?? ""),
      calories: Number(p.total_calories ?? 0), protein: Number(p.total_protein ?? 0),
      carbs: Number(p.total_carbs ?? 0), fat: Number(p.total_fat ?? 0), fiber: Number(p.total_fiber ?? 0),
    })),
    ingredients: ingRows.map((i) => {
      const b = bands.get(String(i.id));
      return {
        id: String(i.id), name: String(i.name), category: String(i.category ?? ""),
        unit: (i.unit as string) ?? null,
        grams_per_unit: i.grams_per_unit == null ? null : Number(i.grams_per_unit),
        small: b?.small ?? 0, usual: b?.usual ?? 0, large: b?.large ?? 0, n: b?.n ?? 0,
      };
    }),
  };
}

/** The context as the text block the agent reads. Tab-separated to keep it small. */
export function renderContext(ctx: AgentContext): string {
  const lines: string[] = [];
  lines.push("## Today");
  lines.push(`date: ${ctx.date}`);
  lines.push(`slot: ${ctx.slot}`);
  lines.push(`calories left for this meal: ${Math.round(ctx.slotBudgetKcal)}`);
  lines.push(`calories left for the whole day: ${Math.round(ctx.dayRemainingKcal)}`);
  if (ctx.weightKg != null) lines.push(`body weight: ${ctx.weightKg.toFixed(1)} kg`);

  lines.push("", "## Saved meals, by name");
  if (!ctx.presets.length) lines.push("(none saved)");
  for (const p of ctx.presets) {
    lines.push([p.id, p.name, p.slot, `${Math.round(p.calories)} kcal`].join("\t"));
  }

  lines.push("", "## Ingredients this owner logs");
  lines.push("Small, usual and large are THIS OWNER'S own amounts in grams, from what they have");
  lines.push("actually eaten. Use them for a portion word. A zero means never logged.");
  lines.push(["id", "name", "category", "unit", "g/unit", "small", "usual", "large", "times logged"].join("\t"));
  for (const i of ctx.ingredients) {
    lines.push([
      i.id, i.name, i.category, i.unit ?? "g", i.grams_per_unit ?? "",
      i.small || "", i.usual || "", i.large || "", i.n || 0,
    ].join("\t"));
  }
  return lines.join("\n");
}
