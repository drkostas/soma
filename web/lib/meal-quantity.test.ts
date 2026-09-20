import { describe, it, expect } from "vitest";
import { resolveQuantities, BITE_FRACTION, BITE_DEFAULT_G, type ResolvableItem } from "./meal-quantity";
import { GENERIC_BANDS, type PortionBand } from "./portion-history";
import type { Ingredient } from "./portion-solver";

const ing = (over: Partial<Ingredient> & { id: string }): Ingredient => ({
  name: over.id, calories_per_100g: 100, protein_per_100g: 10, carbs_per_100g: 10,
  fat_per_100g: 2, fiber_per_100g: 1, category: "protein", ...over,
});

const INGREDIENTS = new Map<string, Ingredient>([
  ["chicken_breast_raw", ing({ id: "chicken_breast_raw", calories_per_100g: 120, protein_per_100g: 23, carbs_per_100g: 0, fat_per_100g: 2.6, fiber_per_100g: 0 })],
  ["white_rice_raw",     ing({ id: "white_rice_raw", category: "carbs", calories_per_100g: 360, protein_per_100g: 7, carbs_per_100g: 79, fat_per_100g: 0.7, fiber_per_100g: 1 })],
  ["eggs_whole",         ing({ id: "eggs_whole", unit: "egg", grams_per_unit: 50, calories_per_100g: 143, protein_per_100g: 13, carbs_per_100g: 1, fat_per_100g: 10, fiber_per_100g: 0 })],
  ["bread_whole_wheat",  ing({ id: "bread_whole_wheat", category: "carbs", unit: "slice", grams_per_unit: 30, calories_per_100g: 250, protein_per_100g: 9, carbs_per_100g: 43, fat_per_100g: 3, fiber_per_100g: 6 })],
  ["olive_oil",          ing({ id: "olive_oil", category: "fat", calories_per_100g: 884, protein_per_100g: 0, carbs_per_100g: 0, fat_per_100g: 100, fiber_per_100g: 0 })],
]);

const BANDS = new Map<string, PortionBand>([
  ["chicken_breast_raw", { small: 104, usual: 150, large: 208, n: 25 }],
  ["white_rice_raw",     { small: 43,  usual: 58,  large: 120, n: 11 }],
]);

const item = (over: Partial<ResolvableItem> & { ingredient_id: string }): ResolvableItem => ({
  query: over.ingredient_id, quantity: { kind: "unknown" }, note: null,
  source: "catalog", confidence: 0.9, ...over,
});

const run = (items: ResolvableItem[], over: { totalGrams?: number | null; slotBudgetKcal?: number } = {}) =>
  resolveQuantities({
    items, totalGrams: over.totalGrams ?? null, slotBudgetKcal: over.slotBudgetKcal ?? 600,
    ingredients: INGREDIENTS, bands: BANDS,
  });

describe("resolveQuantities", () => {
  it("passes stated grams through untouched", () => {
    const r = run([item({ ingredient_id: "chicken_breast_raw", quantity: { kind: "grams", value: 200 } })]);
    expect(r.items[0].grams).toBe(200);
    expect(r.items[0].calories).toBe(240);
    expect(r.weighMethod).toBe("weighed");
  });

  it("turns a count into grams through the ingredient's unit", () => {
    const r = run([item({ ingredient_id: "eggs_whole", quantity: { kind: "count", value: 2 } })]);
    expect(r.items[0].grams).toBe(100);
    expect(r.weighMethod).toBe("counted");
  });

  it("reads a portion word off the owner's own band", () => {
    const r = run([
      item({ ingredient_id: "chicken_breast_raw", quantity: { kind: "portion", value: "large" } }),
      item({ ingredient_id: "white_rice_raw", quantity: { kind: "portion", value: "small" } }),
    ]);
    expect(r.items[0].grams).toBe(208);
    expect(r.items[1].grams).toBe(43);
    expect(r.weighMethod).toBe("portion_words");
  });

  it("divides a stated total by the shares it was given", () => {
    const r = run([
      item({ ingredient_id: "chicken_breast_raw", quantity: { kind: "share_of_total", value: 0.4 } }),
      item({ ingredient_id: "white_rice_raw", quantity: { kind: "share_of_total", value: 0.6 } }),
    ], { totalGrams: 600 });
    expect(r.items.map((i) => i.grams)).toEqual([240, 360]);
    expect(r.weighMethod).toBe("total_split");
  });

  it("makes a bite a third of a unit, and 15g when the food has no unit", () => {
    const r = run([
      item({ ingredient_id: "bread_whole_wheat", quantity: { kind: "bites", value: 3 } }),
      item({ ingredient_id: "olive_oil", quantity: { kind: "bites", value: 2 } }),
    ]);
    expect(r.items[0].grams).toBe(30);
    expect(r.items[1].grams).toBe(30);
    expect(BITE_FRACTION).toBe(3);
    expect(BITE_DEFAULT_G).toBe(15);
  });

  it("NEVER resizes a stated amount when fitting the unstated ones", () => {
    const r = run([
      item({ ingredient_id: "chicken_breast_raw", quantity: { kind: "grams", value: 200 } }),
      item({ ingredient_id: "white_rice_raw", quantity: { kind: "unknown" } }),
    ], { slotBudgetKcal: 600 });
    const chicken = r.items.find((i) => i.ingredient_id === "chicken_breast_raw")!;
    const rice = r.items.find((i) => i.ingredient_id === "white_rice_raw")!;
    expect(chicken.grams).toBe(200);
    expect(rice.grams).toBeGreaterThan(0);
    expect(rice.calories).toBeLessThanOrEqual(400);
    expect(r.weighMethod).toBe("mixed");
  });

  it("falls back to the owner's usual when the stated items already fill the budget", () => {
    const r = run([
      item({ ingredient_id: "chicken_breast_raw", quantity: { kind: "grams", value: 600 } }),
      item({ ingredient_id: "white_rice_raw", quantity: { kind: "unknown" } }),
    ], { slotBudgetKcal: 500 });
    expect(r.items.find((i) => i.ingredient_id === "white_rice_raw")!.grams).toBe(58);
  });

  it("fits every unstated item to the budget when nothing was stated", () => {
    const r = run([
      item({ ingredient_id: "chicken_breast_raw" }),
      item({ ingredient_id: "white_rice_raw" }),
    ], { slotBudgetKcal: 600 });
    const total = r.items.reduce((a, i) => a + i.calories, 0);
    expect(total).toBeGreaterThan(400);
    expect(total).toBeLessThan(800);
    expect(r.weighMethod).toBe("budget_fit");
  });

  it("keeps the note and the provenance on every item", () => {
    const r = run([item({
      ingredient_id: "eggs_whole", quantity: { kind: "count", value: 3 },
      note: "3 only whites", source: "usda", confidence: 0.85,
    })]);
    expect(r.items[0].note).toBe("3 only whites");
    expect(r.items[0].source).toBe("usda");
    expect(r.items[0].confidence).toBe(0.85);
  });

  it("drops a food it has no ingredient for rather than inventing one", () => {
    const r = run([
      item({ ingredient_id: "chicken_breast_raw", quantity: { kind: "grams", value: 100 } }),
      item({ ingredient_id: "not_in_the_catalog", quantity: { kind: "grams", value: 50 } }),
    ]);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].ingredient_id).toBe("chicken_breast_raw");
  });

  it("treats a share with no total as unstated rather than as zero", () => {
    const r = run([item({ ingredient_id: "white_rice_raw", quantity: { kind: "share_of_total", value: 0.5 } })],
      { totalGrams: null, slotBudgetKcal: 400 });
    expect(r.items[0].grams).toBeGreaterThan(0);
  });
});

describe("a count for a food with no unit weight", () => {
  /**
   * The real case, from 2026-09-20. `countToGrams` is `count * (grams_per_unit || 100)`, so the
   * loukoumades row the agent had just created turned 8 into 800 g and 3,040 kcal, which is more
   * than the owner's largest recorded DAY. Every food the agent invents has no unit weight, so
   * this is the common path, not an edge case.
   */
  const loukoumades: Ingredient = {
    id: "loukoumades", name: "loukoumades", category: "carbs",
    calories_per_100g: 380, protein_per_100g: 5, carbs_per_100g: 48, fat_per_100g: 19, fiber_per_100g: 1,
    is_raw: false, unit: "g", grams_per_unit: null,
  } as unknown as Ingredient;

  const egg: Ingredient = {
    id: "eggs_whole", name: "Whole Egg", category: "protein",
    calories_per_100g: 143, protein_per_100g: 12.6, carbs_per_100g: 0.7, fat_per_100g: 9.5, fiber_per_100g: 0,
    is_raw: false, unit: "egg", grams_per_unit: 50,
  } as unknown as Ingredient;

  it("does NOT become 100 g each", () => {
    const r = resolveQuantities({
      items: [{ query: "loukoumades", ingredient_id: "loukoumades", quantity: { kind: "count", value: 8 },
                note: null, source: "estimate", confidence: 0.5 }],
      totalGrams: null, slotBudgetKcal: 400,
      ingredients: new Map([["loukoumades", loukoumades]]),
      bands: new Map(),
    });
    expect(r.items).toHaveLength(1);
    expect(r.items[0].grams).not.toBe(800);
    // The generic carbs band's large is the ceiling for a guess.
    expect(r.items[0].grams).toBeLessThanOrEqual(GENERIC_BANDS.carbs.large);
    expect(r.items[0].calories).toBeLessThan(500);
  });

  it("still converts a count for a food that genuinely has a unit weight", () => {
    const r = resolveQuantities({
      items: [{ query: "eggs", ingredient_id: "eggs_whole", quantity: { kind: "count", value: 2 },
                note: null, source: "catalog", confidence: 0.9 }],
      totalGrams: null, slotBudgetKcal: 400,
      ingredients: new Map([["eggs_whole", egg]]),
      bands: new Map(),
    });
    expect(r.items[0].grams).toBe(100);
    expect(r.weighMethod).toBe("counted");
  });
});

describe("an unstated amount is capped at his own large portion", () => {
  const nuts: Ingredient = {
    id: "mixed_nuts", name: "mixed nuts", category: "fat",
    calories_per_100g: 637, protein_per_100g: 20, carbs_per_100g: 11, fat_per_100g: 57, fiber_per_100g: 7,
    is_raw: false, unit: "g", grams_per_unit: null,
  } as unknown as Ingredient;

  it("never fits more of a food than he has ever eaten of it", () => {
    const bands = new Map([["mixed_nuts", { small: 10, usual: 20, large: 30, n: 12 }]]);
    const r = resolveQuantities({
      items: [{ query: "some nuts", ingredient_id: "mixed_nuts", quantity: { kind: "unknown" },
                note: null, source: "off", confidence: 0.45 }],
      // A generous budget is exactly the condition that produced 113 g of nuts.
      totalGrams: null, slotBudgetKcal: 1500,
      ingredients: new Map([["mixed_nuts", nuts]]),
      bands,
    });
    expect(r.items[0].grams).toBeLessThanOrEqual(30);
  });

  it("falls back to the category band when he has no history for that food", () => {
    const r = resolveQuantities({
      items: [{ query: "some nuts", ingredient_id: "mixed_nuts", quantity: { kind: "unknown" },
                note: null, source: "off", confidence: 0.45 }],
      totalGrams: null, slotBudgetKcal: 1500,
      ingredients: new Map([["mixed_nuts", nuts]]),
      bands: new Map(),
    });
    expect(r.items[0].grams).toBeLessThanOrEqual(GENERIC_BANDS.fat.large);
  });
});
