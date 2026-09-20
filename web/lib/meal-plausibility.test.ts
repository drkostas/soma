import { describe, it, expect } from "vitest";
import {
  amountsWereStated, dayCeiling, enforcePlausibility, FALLBACK_DAY_KCAL, FALLBACK_SLOT_KCAL,
  MIN_OVERSHOOT_KCAL, MIN_SHARE_OF_SLOT, slotCeiling, type HistoryStats,
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
  protein: 5, carbs: 10, fat: 5, fiber: 1, source: "estimate", confidence: 0.5, note: null,
  stated: false, ...o,
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
    // 2,900 eaten already, so the day's own ceiling of 3,014 leaves barely a hundred. The day
    // therefore tightens the dinner ceiling of 1,245 a long way, but only as far as the floor,
    // because a day already near its limit is not a reason to erase the dinner he ate.
    const items = [item({ calories: 1500, grams: 500 })];
    const r = enforcePlausibility({ items, weighMethod: "budget_fit", slot: "dinner", consumedToday: 2900, stats: REAL });
    const bySlot = slotCeiling(REAL, "dinner");
    expect(r.after).toBeLessThan(Math.round(bySlot));
    expect(r.after).toBeGreaterThanOrEqual(Math.floor(bySlot * MIN_SHARE_OF_SLOT) - 1);
    expect(r.note).toContain("day");
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

describe("a day that is already over its ceiling", () => {
  /**
   * The bug this module caused on the day it was written. Repairing the 4,129 kcal breakfast
   * re-ran the capture while that meal was still in the day, so the day headroom was 3014 - 4129
   * = -1115, the ceiling came out at 0, and every item was scaled to one gram and nought
   * calories. Silently deleting food is worse than exaggerating it.
   *
   * My own earlier test used 2,900 eaten against a 3,014 ceiling and never crossed the line,
   * which is exactly why it passed while the real thing broke.
   */
  it("never scales a meal to nothing, however far over the day already is", () => {
    const items = [item({ calories: 600, grams: 200 }), item({ calories: 400, grams: 150 })];
    const r = enforcePlausibility({
      items, weighMethod: "budget_fit", slot: "breakfast", consumedToday: 9999, stats: REAL,
    });
    expect(r.after).toBeGreaterThan(0);
    for (const i of r.items) expect(i.calories + i.grams).toBeGreaterThan(2);
  });

  it("stops at half the slot's own ceiling, and no lower", () => {
    const items = [item({ calories: 5000, grams: 1500 })];
    const r = enforcePlausibility({
      items, weighMethod: "budget_fit", slot: "breakfast", consumedToday: 9999, stats: REAL,
    });
    // breakfast ceiling is 1167, so the floor is 583.
    const floor = slotCeiling(REAL, "breakfast") * MIN_SHARE_OF_SLOT;
    expect(r.after).toBeGreaterThanOrEqual(Math.floor(floor) - 1);
  });

  it("is unaffected by the day when the day has room", () => {
    const items = [item({ calories: 5000, grams: 1500 })];
    const r = enforcePlausibility({
      items, weighMethod: "budget_fit", slot: "breakfast", consumedToday: 0, stats: REAL,
    });
    expect(r.after).toBeLessThanOrEqual(Math.round(slotCeiling(REAL, "breakfast")));
    expect(r.after).toBeGreaterThan(1000);
  });
});

describe("only the guesses are scaled", () => {
  /**
   * The flaw in my own first version. `weighMethod` is one value for the whole meal, and `mixed`
   * means some amounts were given and some were not, which is most meals. Scaling everything by
   * one factor took a weighed 200 g of chicken down to 81 g because a guess about nuts was wrong.
   * An amount he gave is a fact about his morning. A fitted amount is this program's opinion.
   */
  it("leaves a weighed amount exactly as he gave it", () => {
    const items = [
      item({ ingredient_id: "chicken", grams: 200, calories: 330, stated: true }),
      item({ ingredient_id: "nuts", grams: 400, calories: 2548, stated: false }),
    ];
    const r = enforcePlausibility({ items, weighMethod: "mixed", slot: "breakfast", consumedToday: 0, stats: REAL });
    expect(r.items[0].grams).toBe(200);
    expect(r.items[0].calories).toBe(330);
    expect(r.items[1].grams).toBeLessThan(400);
    expect(r.after).toBeLessThanOrEqual(Math.round(slotCeiling(REAL, "breakfast")));
  });

  it("does nothing at all when the whole meal was stated, even far over the ceiling", () => {
    const items = [item({ grams: 900, calories: 3000, stated: true })];
    const r = enforcePlausibility({ items, weighMethod: "mixed", slot: "breakfast", consumedToday: 0, stats: REAL });
    expect(r.note).toBeNull();
    expect(r.items[0].calories).toBe(3000);
  });

  it("does nothing when what he stated already fills the meal, since the rest is his too", () => {
    const items = [
      item({ grams: 700, calories: 1150, stated: true }),
      item({ grams: 20, calories: 30, stated: false }),
    ];
    const r = enforcePlausibility({ items, weighMethod: "mixed", slot: "breakfast", consumedToday: 0, stats: REAL });
    // 1180 is 13 over the 1167 ceiling, which is not worth touching or mentioning.
    expect(r.note).toBeNull();
    expect(r.items[0].calories).toBe(1150);
    expect(r.items[1].calories).toBe(30);
  });

  it("still fixes the real breakfast, where every bad amount was a guess", () => {
    const items = [
      item({ ingredient_id: "eggs_whole", grams: 100, calories: 143, stated: true }),
      item({ ingredient_id: "dark_rye_bread", grams: 50, calories: 108, stated: true }),
      item({ ingredient_id: "sheep_milk_yogurt", grams: 113, calories: 118, stated: false }),
      item({ ingredient_id: "mixed_nuts", grams: 113, calories: 720, stated: false }),
      item({ ingredient_id: "loukoumades", grams: 800, calories: 3040, stated: false }),
    ];
    const r = enforcePlausibility({ items, weighMethod: "mixed", slot: "breakfast", consumedToday: 0, stats: REAL });
    expect(r.before).toBe(4129);
    expect(r.after).toBeLessThanOrEqual(1167);
    // The two he stated are untouched.
    expect(r.items[0].calories).toBe(143);
    expect(r.items[1].calories).toBe(108);
  });
});

describe("MIN_OVERSHOOT_KCAL", () => {
  it("stays quiet just over the ceiling, where a correction would be noise", () => {
    const items = [item({ grams: 400, calories: Math.round(slotCeiling(REAL, "breakfast")) + MIN_OVERSHOOT_KCAL - 20 })];
    const r = enforcePlausibility({ items, weighMethod: "budget_fit", slot: "breakfast", consumedToday: 0, stats: REAL });
    expect(r.note).toBeNull();
    expect(r.after).toBe(r.before);
  });

  it("speaks up once the overshoot is real", () => {
    const items = [item({ grams: 400, calories: Math.round(slotCeiling(REAL, "breakfast")) + MIN_OVERSHOOT_KCAL + 50 })];
    const r = enforcePlausibility({ items, weighMethod: "budget_fit", slot: "breakfast", consumedToday: 0, stats: REAL });
    expect(r.note).not.toBeNull();
    expect(r.after).toBeLessThan(r.before);
  });

  it("is a round, explainable number rather than a tuned one", () => {
    expect(MIN_OVERSHOOT_KCAL).toBe(120);
  });
});

describe("the note says whose amounts were guessed", () => {
  it("says some of the amounts when he gave any of them", () => {
    const items = [
      item({ grams: 100, calories: 200, stated: true }),
      item({ grams: 800, calories: 3000, stated: false }),
    ];
    const r = enforcePlausibility({ items, weighMethod: "mixed", slot: "breakfast", consumedToday: 0, stats: REAL });
    expect(r.note).toContain("some of the amounts");
  });
  it("says the amounts when none of them came from him", () => {
    const items = [item({ grams: 800, calories: 3000, stated: false })];
    const r = enforcePlausibility({ items, weighMethod: "budget_fit", slot: "breakfast", consumedToday: 0, stats: REAL });
    expect(r.note).toContain("guess the amounts");
    expect(r.note).not.toContain("some of the amounts");
  });
});
