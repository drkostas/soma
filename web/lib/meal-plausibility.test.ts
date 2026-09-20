import { describe, it, expect } from "vitest";
import {
  amountsWereStated, dayCeiling, enforcePlausibility, FALLBACK_DAY_KCAL, FALLBACK_SLOT_KCAL,
  slotCeiling, type HistoryStats,
} from "./meal-plausibility";
import type { ResolvedItem } from "./meal-quantity";

/** His real distribution on 2026-09-20, read out of meal_log over 180 days. */
const REAL: HistoryStats = {
  slots: new Map([
    ["breakfast", { n: 44, mean: 459, sd: 224, max: 1167 }],
    ["lunch", { n: 48, mean: 433, sd: 246, max: 903 }],
    ["dinner", { n: 33, mean: 538, sd: 230, max: 1245 }],
    ["pre_sleep", { n: 24, mean: 277, sd: 146, max: 798 }],
    ["during_workout", { n: 6, mean: 176, sd: 169, max: 500 }],
  ]),
  day: { n: 38, mean: 1748, sd: 633, max: 2886 },
};

const item = (o: Partial<ResolvedItem>): ResolvedItem => ({
  ingredient_id: "x", name: "x", grams: 100, calories: 100,
  protein: 5, carbs: 10, fat: 5, fiber: 1, source: "estimate", confidence: 0.5, note: null, ...o,
});

describe("slotCeiling", () => {
  it("is mean plus three sigma where that is above anything he has eaten", () => {
    // 459 + 3*224 = 1131, and his largest breakfast is 1167, so the largest wins.
    expect(Math.round(slotCeiling(REAL, "breakfast"))).toBe(1167);
  });
  it("never sits below his own record, so a record-breaking meal is not clamped for being one", () => {
    expect(slotCeiling(REAL, "dinner")).toBeGreaterThanOrEqual(1245);
  });
  it("falls back where there is too little history to have a spread", () => {
    // during_workout has 6 meals, under the minimum.
    expect(slotCeiling(REAL, "during_workout")).toBe(FALLBACK_SLOT_KCAL);
    expect(slotCeiling(REAL, "second_breakfast")).toBe(FALLBACK_SLOT_KCAL);
  });
});

describe("dayCeiling", () => {
  it("is two sigma at the day level, because a day of outliers is not a day he has had", () => {
    // 1748 + 2*633 = 3014, above his largest day of 2886.
    expect(Math.round(dayCeiling(REAL))).toBe(3014);
  });
  it("falls back with no history", () => {
    expect(dayCeiling({ slots: new Map(), day: { n: 0, mean: 0, sd: 0, max: 0 } })).toBe(FALLBACK_DAY_KCAL);
  });
});

describe("amountsWereStated", () => {
  it("counts every way he can give an amount himself", () => {
    for (const m of ["weighed", "counted", "portion_words", "total_split", "bites"] as const) {
      expect(amountsWereStated(m)).toBe(true);
    }
  });
  it("does not count a fit, which is the only thing this module may touch", () => {
    expect(amountsWereStated("budget_fit")).toBe(false);
    expect(amountsWereStated("mixed")).toBe(false);
  });
});

describe("enforcePlausibility", () => {
  it("leaves an ordinary meal exactly alone", () => {
    const items = [item({ calories: 420, grams: 200 })];
    const r = enforcePlausibility({ items, weighMethod: "budget_fit", slot: "breakfast", consumedToday: 0, stats: REAL });
    expect(r.note).toBeNull();
    expect(r.items).toBe(items);
    expect(r.after).toBe(420);
  });

  it("does NOT touch a weighed meal, however large", () => {
    // He weighed a 2,000 kcal dinner. That is a real dinner and none of this module's business.
    const items = [item({ calories: 2000, grams: 700 })];
    const r = enforcePlausibility({ items, weighMethod: "weighed", slot: "dinner", consumedToday: 0, stats: REAL });
    expect(r.note).toBeNull();
    expect(r.items[0].calories).toBe(2000);
  });

  it("pulls back the real 4,129 kcal breakfast to something he has actually eaten", () => {
    const items = [
      item({ ingredient_id: "eggs_whole", calories: 143, grams: 100 }),
      item({ ingredient_id: "dark_rye_bread", calories: 108, grams: 50 }),
      item({ ingredient_id: "sheep_milk_yogurt", calories: 118, grams: 113 }),
      item({ ingredient_id: "mixed_nuts", calories: 720, grams: 113 }),
      item({ ingredient_id: "loukoumades", calories: 3040, grams: 800 }),
    ];
    const r = enforcePlausibility({ items, weighMethod: "mixed", slot: "breakfast", consumedToday: 0, stats: REAL });
    expect(r.before).toBe(4129);
    expect(r.after).toBeLessThanOrEqual(1167);
    expect(r.note).toContain("4129");
    expect(r.note).toContain("more than you ever eat");
    // The proportions the agent read off the plate are kept.
    const loukRatio = r.items[4].calories / r.after;
    expect(loukRatio).toBeGreaterThan(0.6);
  });

  it("honours what the day already holds, which is what he asked for", () => {
    // 2,900 eaten already, so the day's own ceiling of 3,014 leaves barely a hundred.
    const items = [item({ calories: 900, grams: 300 })];
    const r = enforcePlausibility({ items, weighMethod: "budget_fit", slot: "dinner", consumedToday: 2900, stats: REAL });
    expect(r.after).toBeLessThanOrEqual(120);
    expect(r.note).toContain("the day");
  });

  it("names the slot when the slot is what limits it", () => {
    const items = [item({ calories: 3000, grams: 900 })];
    const r = enforcePlausibility({ items, weighMethod: "budget_fit", slot: "pre_sleep", consumedToday: 0, stats: REAL });
    expect(r.note).toContain("pre sleep");
  });

  it("never scales an item to zero grams, which would silently drop a food", () => {
    const items = [item({ calories: 4000, grams: 4 }), item({ calories: 100, grams: 100 })];
    const r = enforcePlausibility({ items, weighMethod: "budget_fit", slot: "breakfast", consumedToday: 0, stats: REAL });
    for (const i of r.items) expect(i.grams).toBeGreaterThanOrEqual(1);
  });

  it("says nothing about a meal of nothing", () => {
    const r = enforcePlausibility({ items: [], weighMethod: "budget_fit", slot: "lunch", consumedToday: 0, stats: REAL });
    expect(r.note).toBeNull();
    expect(r.after).toBe(0);
  });
});
