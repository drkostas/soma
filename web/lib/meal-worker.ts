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
import { runMealAgent, type ProposalItem, uploadsDir } from "./nutrition-agent";
import { getPortionBands } from "./portion-history";
import { resolveQuantities, type ResolvableItem, type ResolvedItem } from "./meal-quantity";
import { enforcePlausibility, getHistoryStats } from "./meal-plausibility";
import { materialise } from "./capture-image";
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
  // ⛔ The category was hardcoded to 'restaurant', and it is not decoration: it picks the solver's
  // gram bounds AND which portion band applies. That is why "some nuts" came out at 113 g, the
  // restaurant band's usual, rather than the 15 g a fat belongs at. The unit weight matters just
  // as much: without it a count cannot be converted and the old fallback was 100 g each.
  const category = item.category ?? "restaurant";
  const unit = item.grams_per_unit ? (item.unit_name ?? "piece") : "g";
  await sql`
    INSERT INTO ingredients (id, name, calories_per_100g, protein_per_100g, carbs_per_100g,
                             fat_per_100g, fiber_per_100g, category, status, source, confidence,
                             unit, grams_per_unit)
    VALUES (${id}, ${item.query.slice(0, 120)}, ${m.calories}, ${m.protein}, ${m.carbs},
            ${m.fat}, ${m.fiber}, ${category}, 'confirmed', ${item.source}, ${item.confidence},
            ${unit}, ${item.grams_per_unit})
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
  sql: QueryFn, date: string, slot: string, excludeMealId: number | null = null,
): Promise<{ slotKcal: number; dayLeft: number; consumed: number }> {
  const dayRows = (await sql`
    SELECT COALESCE(target_calories, 0)::float AS target
    FROM nutrition_day WHERE date = ${date}`) as Array<{ target: number }>;
  const eatenRows = (await sql`
    SELECT COALESCE(sum(calories), 0)::float AS eaten FROM meal_log
    WHERE date = ${date} AND (${excludeMealId}::int IS NULL OR id <> ${excludeMealId}::int)`) as Array<{ eaten: number }>;
  const dayTarget = Number(dayRows[0]?.target ?? 0);
  const consumed = Number(eatenRows[0]?.eaten ?? 0);
  // `excludeMealId` is the capture's own previous meal when it is being corrected. Counting it
  // would have the meal compete with the version of itself it is replacing, which on 2026-09-20
  // drove the day headroom negative and scaled the replacement to nothing.
  return {
    slotKcal: slotBudget({ dayTarget, consumed, slotsLeft: slotsRemaining(slot) }),
    dayLeft: Math.max(0, dayTarget - consumed),
    // What the day already holds, so "based on the day so far" is a real input rather than a
    // figure of speech. Unlike dayLeft this does not depend on a plan existing.
    consumed,
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
  // ⛔ A capture owns at most ONE meal. A follow-up re-runs the whole conversation, which is
  // right, and this used to INSERT a second row while the capture's meal_log_id moved on, so the
  // meal being corrected stayed in the day's total. Correcting a mistake made the day grow.
  if (cap.meal_log_id != null) {
    await sql`DELETE FROM meal_log WHERE id = ${cap.meal_log_id}`;
  }
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
    const { slotKcal, dayLeft, consumed: dayConsumed } = await budgetForDay(sql, cap.date, slot, cap.meal_log_id);
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
      // The agent opens a file, and a photo from the phone lives in the database, so write it out
      // here. A reference that is already a path comes back untouched.
      const thread: Array<{ role: "user" | "agent"; text: string; image: string | null }> = [];
      for (const m of cap.messages) {
        const image = m.image ? await materialise(sql, m.image, uploadsDir()) : null;
        thread.push({ role: m.role, text: m.text, image });
      }
      const run = await runMealAgent(ctx, thread);
      proposal = run.proposal;
      resolvedSlot = run.proposal.slot;
      summary = run.proposal.summary;
      totalGrams = run.proposal.total_grams;

      // It could identify nothing and asked. Put the question in the thread and wait: the owner
      // answers with a follow-up, which re-runs this with the whole conversation. NOT a failure,
      // and the sentence stays exactly where it was.
      if (!run.proposal.items.length && run.proposal.question) {
        await finishCapture(sql, {
          id: cap.id, status: "ready", proposal, slot: resolvedSlot,
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
    const { items: raw, weighMethod } = resolveQuantities({
      items, totalGrams, slotBudgetKcal: slotKcal, ingredients, bands,
    });
    if (!raw.length) throw new Error("nothing left after resolving quantities");

    // The backstop. Amounts he stated are never touched; amounts we guessed are pulled back when
    // the meal is nothing like anything in his log. It says so when it does, so the strip shows it.
    const stats = await getHistoryStats(sql);
    const check = enforcePlausibility({
      items: raw, weighMethod, slot: resolvedSlot, consumedToday: dayConsumed, stats,
    });
    const resolved = check.items;
    if (check.note) summary = `${summary} ${check.note}`;

    let mealLogId: number | null = null;
    if (cap.mode === "log") mealLogId = await writeMeal(sql, cap, resolvedSlot, resolved, weighMethod);

    const status: CaptureStatus = cap.mode === "log" ? "logged" : "ready";
    // Store how the grams were arrived at alongside them. A calibrate capture is a proposal the
    // builder will open, and "these came from a portion word" is part of the proposal, not just a
    // column on a meal that may never be written.
    await finishCapture(sql, {
      id: cap.id, status, proposal, resolved: { items: resolved, weighMethod }, mealLogId,
      slot: resolvedSlot,
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

/** Whether the meal agent can actually be spawned in this process. The app posts to
 *  soma.gkos.dev, so most captures arrive on Vercel, which has no `claude` binary. Claiming one
 *  there spends an attempt on a run that cannot succeed, and two of those mark the capture
 *  `failed` before the Mac's sweep ever sees it. Same test chat-transport.ts uses. */
export function agentRunsHere(): boolean {
  return !process.env.VERCEL;
}

/** Drain the queue. Called after a capture and on a sweep, so a restart strands nothing.
 *  A no-op where the agent cannot run, so the row waits for the sweep with its attempts intact. */
export async function drainCaptures(sql: QueryFn, max = 5): Promise<number> {
  if (!agentRunsHere()) return 0;
  let done = 0;
  for (let i = 0; i < max; i++) {
    const cap = await claimNextCapture(sql);
    if (!cap) break;
    await processCapture(sql, cap);
    done++;
  }
  return done;
}
