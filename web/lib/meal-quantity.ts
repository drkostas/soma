/**
 * Words to grams, and the only place in this feature where arithmetic happens.
 *
 * The agent says what the foods are and how much in the owner's own terms. It never sees a sum,
 * so it cannot get one wrong. Everything here is pure given its inputs, which is why it carries
 * the heaviest tests in the feature.
 */
import { type Ingredient, computeItemMacros, countToGrams, isCountBased, solvePortions } from "./portion-solver";
import { bandFor, type PortionBand } from "./portion-history";

export type Quantity =
  | { kind: "grams"; value: number }
  | { kind: "count"; value: number }
  | { kind: "portion"; value: "small" | "moderate" | "large" }
  | { kind: "share_of_total"; value: number }
  | { kind: "bites"; value: number }
  | { kind: "unknown" };

/** A proposal item after the worker has given every food a real catalog id. */
export interface ResolvableItem {
  query: string;
  ingredient_id: string;
  quantity: Quantity;
  note: string | null;
  source: string;
  confidence: number;
}

export interface ResolvedItem {
  ingredient_id: string; name: string; grams: number;
  calories: number; protein: number; carbs: number; fat: number; fiber: number;
  source: string; confidence: number; note: string | null;
  /**
   * Whether the owner gave this amount, rather than it being fitted to the budget.
   *
   * ⛔ THIS IS THE ONLY THING THAT MAKES THE PLAUSIBILITY GUARD HONEST. It used to decide from
   * `weighMethod`, which is one value for the whole meal, so in a `mixed` meal a weighed 200 g of
   * chicken was scaled down to 81 g because a guess about nuts was wrong. A guess is what may be
   * corrected; a weight he took is not.
   */
  stated: boolean;
}

export type WeighMethod =
  | "weighed" | "counted" | "portion_words" | "total_split"
  | "bites" | "budget_fit" | "mixed";

/** A bite is a third of one unit of the food. The owner's bread slice is 30g, so a bite is 10g. */
export const BITE_FRACTION = 3;
/** A bite of something with no unit at all. One constant, adjustable once real use says otherwise. */
export const BITE_DEFAULT_G = 15;

export interface ResolveInput {
  items: ResolvableItem[];
  totalGrams: number | null;
  slotBudgetKcal: number;
  ingredients: Map<string, Ingredient>;
  bands: Map<string, PortionBand>;
}

export interface ResolveResult { items: ResolvedItem[]; weighMethod: WeighMethod }

/** Grams for one item, or null when the quantity cannot be settled without the budget. */
function gramsFor(
  item: ResolvableItem, ing: Ingredient, totalGrams: number | null, bands: Map<string, PortionBand>,
): number | null {
  const q = item.quantity;
  switch (q.kind) {
    case "grams":
      return Math.max(0, Math.round(q.value));
    case "count":
      // ⛔ `countToGrams` is `count * (grams_per_unit || 100)`, so a food with no unit weight
      // silently becomes 100 g each. Every food the agent invents is that food, which is how
      // 8 loukoumades became 800 g and 3,040 kcal. A count we cannot convert is an amount nobody
      // has stated in grams, so it goes to the deferred items and is bounded like one.
      if (!isCountBased(ing)) return null;
      return Math.max(0, Math.round(countToGrams(ing, q.value)));
    case "portion": {
      const b = bandFor(bands, ing.id, ing.category);
      return q.value === "small" ? b.small : q.value === "large" ? b.large : b.usual;
    }
    case "share_of_total":
      // A share with nothing to take a share of is not zero, it is unstated. The budget settles it.
      return totalGrams == null ? null : Math.round(totalGrams * Math.max(0, q.value));
    case "bites": {
      const per = isCountBased(ing) && ing.grams_per_unit
        ? ing.grams_per_unit / BITE_FRACTION
        : BITE_DEFAULT_G;
      return Math.round(per * Math.max(0, q.value));
    }
    case "unknown":
      return null;
  }
}

function methodFor(kinds: Set<Quantity["kind"]>): WeighMethod {
  if (kinds.size > 1) return "mixed";
  switch ([...kinds][0]) {
    case "grams": return "weighed";
    case "count": return "counted";
    case "portion": return "portion_words";
    case "share_of_total": return "total_split";
    case "bites": return "bites";
    default: return "budget_fit";
  }
}

export function resolveQuantities(input: ResolveInput): ResolveResult {
  const { items, totalGrams, slotBudgetKcal, ingredients, bands } = input;

  const known = new Map<number, number>();
  const deferred: number[] = [];
  items.forEach((it, i) => {
    const ing = ingredients.get(it.ingredient_id);
    if (!ing) return; // the worker gives every food an id; one that is still missing is dropped
    const g = gramsFor(it, ing, totalGrams, bands);
    if (g == null) deferred.push(i); else known.set(i, g);
  });

  // ⛔ Fit ONLY the unsettled items, and only to what the stated ones left behind. Passing the
  // whole list to solvePortions would silently resize an amount the owner actually gave.
  if (deferred.length) {
    let spent = 0;
    for (const [i, g] of known) {
      const ing = ingredients.get(items[i].ingredient_id)!;
      spent += computeItemMacros(ing, g).calories;
    }
    const remaining = slotBudgetKcal - spent;
    const deferredIngs = deferred.map((i) => ingredients.get(items[i].ingredient_id)!);
    if (remaining > 0) {
      const portions = solvePortions(deferredIngs, { calories: remaining });
      const byId = new Map(portions.map((p) => [p.ingredient_id, p.grams]));
      for (const i of deferred) {
        const ing = ingredients.get(items[i].ingredient_id)!;
        const band = bandFor(bands, ing.id, ing.category);
        const fitted = Math.round(byId.get(ing.id) ?? band.usual);
        // ⛔ The solver fits to the budget, and the budget knows nothing about how much of THIS
        // food he has ever eaten. "Some nuts" came back as 113 g, which is 720 kcal of nuts. His
        // own largest portion is the ceiling: an unstated amount is a guess, and a guess should
        // not exceed anything he has actually done.
        known.set(i, Math.min(fitted, band.large));
      }
    } else {
      // The stated foods already fill the meal. The rest get the owner's usual amount.
      for (const i of deferred) {
        const ing = ingredients.get(items[i].ingredient_id)!;
        known.set(i, bandFor(bands, ing.id, ing.category).usual);
      }
    }
  }

  // The indices the resolver had to guess at, which is exactly what `stated` is the negation of.
  const guessed = new Set(deferred);

  const out: ResolvedItem[] = [];
  const kinds = new Set<Quantity["kind"]>();
  items.forEach((it, i) => {
    const ing = ingredients.get(it.ingredient_id);
    const grams = known.get(i);
    if (!ing || grams == null) return;
    kinds.add(it.quantity.kind);
    const m = computeItemMacros(ing, grams);
    out.push({
      ingredient_id: ing.id, name: ing.name, grams,
      calories: Math.round(m.calories), protein: Math.round(m.protein * 10) / 10,
      carbs: Math.round(m.carbs * 10) / 10, fat: Math.round(m.fat * 10) / 10,
      fiber: Math.round(m.fiber * 10) / 10,
      source: it.source, confidence: it.confidence, note: it.note,
      stated: !guessed.has(i),
    });
  });

  return { items: out, weighMethod: methodFor(kinds) };
}
