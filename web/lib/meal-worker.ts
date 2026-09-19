/**
 * From the owner's sentence to a meal.
 *
 * Tries the model-free reading first, falls back to the agent, gives every unmatched food a real
 * catalog row so the builder can render it, converts to grams in one place, lands the result, and
 * says so. A failure anywhere leaves the owner's words untouched and retriable, which is the whole
 * reason the capture is a row of its own.
 */
import type { QueryFn } from "./db";
import { claimNextCapture, finishCapture, MAX_ATTEMPTS, type CaptureRow, type CaptureStatus } from "./meal-capture";
import { fastParse, type CatalogEntry } from "./meal-fast-path";
import { buildAgentContext, renderContext } from "./nutrition-agent-context";
import { runMealAgent, type ProposalItem } from "./nutrition-agent";
import { getPortionBands } from "./portion-history";
import { resolveQuantities, type ResolvableItem, type ResolvedItem } from "./meal-quantity";
import type { Ingredient } from "./portion-solver";
import { sendPush } from "./notify-push";

/** A day with no plan still gets an ordinary meal rather than a budget of nothing. */
const DEFAULT_MEAL_KCAL = 500;
/** The slots that make up a day, in order. during_workout sits outside it. */
const DAY_SLOTS = ["breakfast", "lunch", "dinner", "pre_sleep"] as const;

export interface LandedMeal { slot: string; summary: string; captureId: number; mealLogId: number | null }

export function slotsRemaining(slot: string): number {
  const i = DAY_SLOTS.indexOf(slot as (typeof DAY_SLOTS)[number]);
  // during_workout is fuelling, not a point in the day, so it gets what is left rather than a share.
  return i < 0 ? 1 : DAY_SLOTS.length - i;
}

export function slotBudget(o: { dayTarget: number; consumed: number; slotsLeft: number }): number {
  if (!o.dayTarget) return DEFAULT_MEAL_KCAL;
  const left = o.dayTarget - o.consumed;
  if (left <= 0) return 0;
  return Math.round(left / Math.max(1, o.slotsLeft));
}

/** A stable catalog id from a food's name, or null when the name has nothing usable in it. */
export function ingredientIdFor(name: string): string | null {
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
  return id || null;
}

export function notificationFor(
  status: "logged" | "ready" | "failed" | "asked", meal: LandedMeal,
): { title: string; body: string; url: string } {
  const url = `/nutrition?capture=${meal.captureId}`;
  if (status === "logged") return { title: `Logged ${meal.slot}`, body: meal.summary, url };
  if (status === "ready") return { title: `${meal.slot} ready to check`, body: meal.summary, url };
  // The one question the instructions allow. It carries the question itself, because a
  // notification saying only "soma has a question" makes the owner go and find out what it is.
  if (status === "asked") return { title: "One question about that meal", body: meal.summary, url };
  return {
    title: "Could not work that meal out",
    body: "Your words are still there. Open it to try again or fix it by hand.",
    url,
  };
}

/** Give an unmatched food a real catalog row, so it renders and so it is known next time. */
async function ensureIngredient(sql: QueryFn, item: ProposalItem): Promise<string | null> {
  if (item.ingredient_id) return item.ingredient_id;
  if (!item.macros_per_100g) return null;
  const id = ingredientIdFor(item.query);
  if (!id) return null;
  const m = item.macros_per_100g;
  await sql`
    INSERT INTO ingredients (id, name, calories_per_100g, protein_per_100g, carbs_per_100g,
                             fat_per_100g, fiber_per_100g, category, status, source, confidence)
    VALUES (${id}, ${item.query.slice(0, 120)}, ${m.calories}, ${m.protein}, ${m.carbs},
            ${m.fat}, ${m.fiber}, 'restaurant', 'confirmed', ${item.source}, ${item.confidence})
    ON CONFLICT (id) DO NOTHING`;
  return id;
}

async function loadIngredients(sql: QueryFn, ids: string[]): Promise<Map<string, Ingredient>> {
  if (!ids.length) return new Map();
  const rows = (await sql`
    SELECT id, name, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g,
           fiber_per_100g, category, is_raw, raw_to_cooked_ratio, unit, grams_per_unit, unit_step
    FROM ingredients WHERE id = ANY(${ids})`) as Array<Record<string, unknown>>;
  const m = new Map<string, Ingredient>();
  for (const r of rows) m.set(String(r.id), r as unknown as Ingredient);
  return m;
}

async function budgetForDay(
  sql: QueryFn, date: string, slot: string,
): Promise<{ slotKcal: number; dayLeft: number }> {
  const dayRows = (await sql`
    SELECT COALESCE(target_calories, 0)::float AS target
    FROM nutrition_day WHERE date = ${date}`) as Array<{ target: number }>;
  const eatenRows = (await sql`
    SELECT COALESCE(sum(calories), 0)::float AS eaten FROM meal_log WHERE date = ${date}`) as Array<{ eaten: number }>;
  const dayTarget = Number(dayRows[0]?.target ?? 0);
  const consumed = Number(eatenRows[0]?.eaten ?? 0);
  return {
    slotKcal: slotBudget({ dayTarget, consumed, slotsLeft: slotsRemaining(slot) }),
    dayLeft: Math.max(0, dayTarget - consumed),
  };
}

async function writeMeal(
  sql: QueryFn, cap: CaptureRow, slot: string, items: ResolvedItem[], weighMethod: string,
): Promise<number> {
  const t = items.reduce((a, i) => ({
    calories: a.calories + i.calories, protein: a.protein + i.protein,
    carbs: a.carbs + i.carbs, fat: a.fat + i.fat, fiber: a.fiber + i.fiber,
  }), { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });
  const notes = cap.messages.filter((m) => m.role === "user").map((m) => m.text).join(" / ").slice(0, 1000);
  const source = cap.messages.some((m) => m.image) ? "photo" : "chat";

  await sql`INSERT INTO nutrition_day (date) VALUES (${cap.date}) ON CONFLICT (date) DO NOTHING`;
  const rows = (await sql`
    INSERT INTO meal_log (date, meal_slot, source, portion_multiplier, items,
                          calories, protein, carbs, fat, fiber, notes, weigh_method)
    VALUES (${cap.date}, ${slot}, ${source}, 1.0, ${JSON.stringify(items)}::jsonb,
            ${Math.round(t.calories)}, ${Math.round(t.protein)}, ${Math.round(t.carbs)},
            ${Math.round(t.fat)}, ${Math.round(t.fiber)}, ${notes}, ${weighMethod})
    RETURNING id`) as Array<{ id: number }>;
  return Number(rows[0].id);
}

async function notify(
  sql: QueryFn, status: "logged" | "ready" | "failed" | "asked", meal: LandedMeal,
): Promise<void> {
  const n = notificationFor(status, meal);
  // A notification is never worth failing a meal over.
  try { await sendPush(sql, { ...n, eventType: "meal_ready" }); } catch { /* ignored */ }
}

export async function processCapture(sql: QueryFn, cap: CaptureRow): Promise<void> {
  const slot = cap.meal_slot ?? "lunch";
  try {
    const { slotKcal, dayLeft } = await budgetForDay(sql, cap.date, slot);
    const catalog = (await sql`
      SELECT id, name FROM ingredients WHERE status = 'confirmed'`) as CatalogEntry[];

    const lastUser = [...cap.messages].reverse().find((m) => m.role === "user");
    const firstTurn = cap.messages.length === 1 && !cap.messages[0].image;

    let items: ResolvableItem[] | null = null;
    let summary = "";
    let proposal: unknown = null;
    let resolvedSlot = slot;
    let totalGrams: number | null = null;

    // The model-free reading is only tried on a first, image-free turn. A follow-up means the
    // owner is correcting something, which by definition needs judgement.
    if (firstTurn && lastUser) items = fastParse(lastUser.text, catalog);

    if (items) {
      summary = `Logged ${slot}: ${lastUser!.text}`;
    } else {
      const ctx = renderContext(await buildAgentContext(sql, cap.date, slot, slotKcal, dayLeft));
      const run = await runMealAgent(
        ctx, cap.messages.map((m) => ({ role: m.role, text: m.text, image: m.image })),
      );
      proposal = run.proposal;
      resolvedSlot = run.proposal.slot;
      summary = run.proposal.summary;
      totalGrams = run.proposal.total_grams;

      // It could identify nothing and asked. Put the question in the thread and wait: the owner
      // answers with a follow-up, which re-runs this with the whole conversation. NOT a failure,
      // and the sentence stays exactly where it was.
      if (!run.proposal.items.length && run.proposal.question) {
        await finishCapture(sql, {
          id: cap.id, status: "ready", proposal,
          message: { role: "agent", text: run.proposal.question, image: null, at: new Date().toISOString() },
        });
        await notify(sql, "asked", {
          slot: resolvedSlot, summary: run.proposal.question, captureId: cap.id, mealLogId: null,
        });
        return;
      }
      const resolvable: ResolvableItem[] = [];
      for (const it of run.proposal.items) {
        const id = await ensureIngredient(sql, it);
        if (!id) continue;
        resolvable.push({
          query: it.query, ingredient_id: id, quantity: it.quantity,
          note: it.note, source: it.source, confidence: it.confidence,
        });
      }
      if (!resolvable.length) throw new Error("no food in that sentence could be resolved");
      items = resolvable;
    }

    const bands = await getPortionBands(sql);
    const ingredients = await loadIngredients(sql, items.map((i) => i.ingredient_id));
    const { items: resolved, weighMethod } = resolveQuantities({
      items, totalGrams, slotBudgetKcal: slotKcal, ingredients, bands,
    });
    if (!resolved.length) throw new Error("nothing left after resolving quantities");

    let mealLogId: number | null = null;
    if (cap.mode === "log") mealLogId = await writeMeal(sql, cap, resolvedSlot, resolved, weighMethod);

    const status: CaptureStatus = cap.mode === "log" ? "logged" : "ready";
    // Store how the grams were arrived at alongside them. A calibrate capture is a proposal the
    // builder will open, and "these came from a portion word" is part of the proposal, not just a
    // column on a meal that may never be written.
    await finishCapture(sql, {
      id: cap.id, status, proposal, resolved: { items: resolved, weighMethod }, mealLogId,
      message: { role: "agent", text: summary, image: null, at: new Date().toISOString() },
    });
    await notify(sql, status, { slot: resolvedSlot, summary, captureId: cap.id, mealLogId });
  } catch (e) {
    const msg = (e as Error).message;
    const status: CaptureStatus = cap.attempts >= MAX_ATTEMPTS ? "failed" : "captured";
    await finishCapture(sql, { id: cap.id, status, error: msg });
    if (status === "failed") {
      await notify(sql, "failed", { slot, summary: "", captureId: cap.id, mealLogId: null });
    }
  }
}

/**
 * Put anything stuck back in the queue.
 *
 * A capture goes to `running` and the process that owns it dies; nothing else would ever look at
 * it again. Ten minutes is far longer than the slowest real run, which is about a minute.
 */
export async function reviveStalled(sql: QueryFn, olderThanMinutes = 10): Promise<number> {
  const rows = (await sql`
    UPDATE meal_capture SET status = 'captured', updated_at = now()
    WHERE status = 'running' AND updated_at < now() - ${`${olderThanMinutes} minutes`}::interval
    RETURNING id`) as Array<{ id: number }>;
  return rows.length;
}

/** Drain the queue. Called after a capture and on a sweep, so a restart strands nothing. */
export async function drainCaptures(sql: QueryFn, max = 5): Promise<number> {
  let done = 0;
  for (let i = 0; i < max; i++) {
    const cap = await claimNextCapture(sql);
    if (!cap) break;
    await processCapture(sql, cap);
    done++;
  }
  return done;
}
