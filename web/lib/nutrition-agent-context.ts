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
/** A meal already on the day, so the agent can tell an addition from the next meal. */
export interface LoggedMeal {
  slot: string;
  /** HH:MM local, because "soon after" is a comparison between two clocks. */
  at: string;
  calories: number;
  /** The foods, named, so a sweet after eggs and yogurt is recognisable as an addition. */
  what: string;
}

export interface AgentContext {
  date: string; slot: string; weightKg: number | null;
  /** HH:MM local now. Without it "soon after breakfast" cannot be judged. */
  now: string;
  slotBudgetKcal: number; dayRemainingKcal: number;
  /** What the day already holds, newest last. */
  logged: LoggedMeal[];
  presets: ContextPreset[];
  ingredients: ContextIngredient[];
}

/**
 * When the meal was eaten, as far as anything knows: what he said, or failing that when the row
 * was written. Never an empty string for a row that has a time, because a blank reads as unknown.
 */
export function eatenAt(saidAt: string | null, loggedAt: string | null): string {
  for (const v of [saidAt, loggedAt]) {
    if (!v) continue;
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return hhmm(d);
  }
  return "";
}

/** One clock for both the logged times and "now", so "soon after" is a real comparison. */
export function hhmm(d: Date): string {
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/** The order of the day, for naming which slots are still empty. */
export const DAY_SLOTS = ["breakfast", "lunch", "dinner", "pre_sleep"] as const;

/** The slots with nothing in them yet, in the order they come. */
export function emptySlots(logged: Array<Pick<LoggedMeal, "slot">>): string[] {
  const taken = new Set(logged.map((m) => m.slot));
  return DAY_SLOTS.filter((s) => !taken.has(s));
}

/**
 * Where the next proper meal belongs: the first empty slot at or after the one the clock suggests.
 *
 * ⛔ NOT simply the earliest empty slot. With nothing logged at half past three that would be
 * breakfast, and a plate of chicken and rice was duly filed as breakfast. A slot in the past that
 * was skipped stays skipped; food arriving now belongs now or later.
 *
 * When everything from here on is taken, it is the last slot of the day, because the food exists
 * and has to go somewhere.
 */
export function nextMealSlot(logged: Array<Pick<LoggedMeal, "slot">>, clockSlot: string): string {
  const from = DAY_SLOTS.indexOf(clockSlot as (typeof DAY_SLOTS)[number]);
  const start = from < 0 ? 0 : from;
  const empty = new Set(emptySlots(logged));
  for (let i = start; i < DAY_SLOTS.length; i++) {
    if (empty.has(DAY_SLOTS[i])) return DAY_SLOTS[i];
  }
  return DAY_SLOTS[DAY_SLOTS.length - 1];
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

  // What the day already holds. Until this was here the agent could only go by the clock, so a
  // sweet eaten twenty minutes after breakfast landed in lunch.
  // ⛔ The time is formatted HERE, not in SQL, and both clocks come from the same place.
  // `AT TIME ZONE 'localtime'` throws on this server, and it throws only once there is a row to
  // project, so it would have sat quiet until the first logged meal of a day. Worse, the database
  // session is on America/New_York while the owner and this process are on Athens, so a time
  // formatted by Postgres would have been seven hours out and "soon after" would be nonsense.
  // ⛔ `logged_at` is when the ROW was written, which is when the drain ran, not when he ate. On a
  // repaired meal it is the repair time, and his day read 13:32 for a breakfast he had said at
  // 10:47. The capture's first message carries the real time, so prefer it and fall back.
  const loggedRows = (await sql`
    SELECT m.meal_slot, m.calories, m.logged_at,
           (SELECT c.messages->0->>'at' FROM meal_capture c
            WHERE c.meal_log_id = m.id ORDER BY c.id LIMIT 1) AS said_at,
           (SELECT string_agg(i->>'name', ', ' ORDER BY (i->>'calories')::float DESC)
            FROM jsonb_array_elements(m.items) i) AS what
    FROM meal_log m WHERE m.date = ${date} ORDER BY m.logged_at`) as Array<Record<string, unknown>>;

  return {
    date, slot, slotBudgetKcal, dayRemainingKcal,
    now: hhmm(new Date()),
    logged: loggedRows.map((r) => ({
      slot: String(r.meal_slot ?? ""),
      at: eatenAt(r.said_at as string | null, r.logged_at as string | null),
      calories: Math.round(Number(r.calories ?? 0)),
      what: String(r.what ?? "").slice(0, 200),
    })),
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
  lines.push(`time now: ${ctx.now}`);
  lines.push(`slot the clock suggests: ${ctx.slot}`);
  lines.push(`calories left for this meal: ${Math.round(ctx.slotBudgetKcal)}`);
  lines.push(`calories left for the whole day: ${Math.round(ctx.dayRemainingKcal)}`);
  if (ctx.weightKg != null) lines.push(`body weight: ${ctx.weightKg.toFixed(1)} kg`);

  lines.push("", "## Already logged today");
  if (!ctx.logged.length) {
    lines.push("(nothing yet today)");
  } else {
    lines.push(["slot", "logged at", "kcal", "what"].join("\t"));
    for (const m of ctx.logged) {
      lines.push([m.slot, m.at, `${m.calories}`, m.what].join("\t"));
    }
  }
  const empty = emptySlots(ctx.logged);
  lines.push(`slots still empty: ${empty.length ? empty.join(", ") : "none"}`);
  lines.push(`where a NEW meal belongs: ${nextMealSlot(ctx.logged, ctx.slot)}`);
  const last = ctx.logged[ctx.logged.length - 1];
  lines.push(`the last meal logged: ${last ? `${last.slot} at ${last.at}` : "none yet"}`);

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
