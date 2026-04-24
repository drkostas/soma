/**
 * Tests for the portion solver after #83 — target is {calories, proteinMpsFloor}
 * only. Non-kcal macros (C/F/Fi) emerge from ingredient selection, not from a
 * proportional slot allocation.
 */
import { describe, it, expect } from "vitest";
import { solvePortions, sumPortionMacros, type Ingredient } from "./portion-solver";

// ── Test fixtures ────────────────────────────────────────────

const chicken: Ingredient = {
  id: "chicken_raw",
  name: "Chicken Breast (raw)",
  calories_per_100g: 120,
  protein_per_100g: 23,
  carbs_per_100g: 0,
  fat_per_100g: 2.5,
  fiber_per_100g: 0,
  category: "protein",
};

const rice: Ingredient = {
  id: "white_rice",
  name: "White Rice (raw)",
  calories_per_100g: 360,
  protein_per_100g: 7,
  carbs_per_100g: 80,
  fat_per_100g: 0.6,
  fiber_per_100g: 1.3,
  category: "carbs",
};

const oliveOil: Ingredient = {
  id: "olive_oil",
  name: "Olive Oil",
  calories_per_100g: 884,
  protein_per_100g: 0,
  carbs_per_100g: 0,
  fat_per_100g: 100,
  fiber_per_100g: 0,
  category: "fat",
};

const broccoli: Ingredient = {
  id: "broccoli_raw",
  name: "Broccoli",
  calories_per_100g: 34,
  protein_per_100g: 2.8,
  carbs_per_100g: 7,
  fat_per_100g: 0.4,
  fiber_per_100g: 2.6,
  category: "vegetable",
};

// ── Tests ────────────────────────────────────────────

describe("solvePortions (kcal + MPS contract)", () => {
  it("returns an empty array for empty ingredient list", () => {
    const result = solvePortions([], { calories: 500 });
    expect(result).toEqual([]);
  });

  it("hits the kcal target within ±10% for a balanced meal", () => {
    const result = solvePortions([chicken, rice, broccoli], { calories: 700 });
    const totals = sumPortionMacros(result);
    expect(totals.calories).toBeGreaterThanOrEqual(630);
    expect(totals.calories).toBeLessThanOrEqual(770);
  });

  it("ensures protein hits the MPS floor (≥30g) when ingredients allow it", () => {
    const result = solvePortions([chicken, rice, broccoli], { calories: 700 });
    const totals = sumPortionMacros(result);
    expect(totals.protein).toBeGreaterThanOrEqual(30);
  });

  it("boosts a weak protein source to reach MPS floor when kcal is generous", () => {
    // Tofu-like mix: only rice (7g P per 100g) + broccoli. Naturally a kcal-
    // hitting mix gets maybe ~20g protein. The solver must lean on the highest-
    // protein-density scalable ingredient (rice here, since broccoli is fixed)
    // to reach the 30g floor.
    const tofu: Ingredient = {
      id: "tofu",
      name: "Tofu",
      calories_per_100g: 76,
      protein_per_100g: 8,
      carbs_per_100g: 1.9,
      fat_per_100g: 4.8,
      fiber_per_100g: 0.3,
      category: "protein",
    };
    const result = solvePortions([tofu, rice, broccoli], { calories: 700 });
    const totals = sumPortionMacros(result);
    // With tofu as the protein source at ~8g P/100g, reaching 30g means ~375g
    // of tofu, which fits within kcal budget. The solver must handle this.
    expect(totals.protein).toBeGreaterThanOrEqual(30);
    expect(totals.calories).toBeLessThanOrEqual(770); // still respects kcal
  });

  it("does NOT force carbs/fat/fiber toward a proportional slot share", () => {
    // With only protein + fat ingredients (no carb source), carbs should be
    // near-zero — not forced to a 25%-of-daily value.
    const result = solvePortions([chicken, oliveOil], { calories: 600 });
    const totals = sumPortionMacros(result);
    // Chicken has 0 carbs, olive oil has 0 carbs → totals.carbs must be 0
    expect(totals.carbs).toBe(0);
  });

  it("does NOT inflate fat above what ingredients naturally provide", () => {
    // All-chicken meal — fat is whatever 23%-protein chicken provides, not a
    // proportional slot fat target.
    const result = solvePortions([chicken], { calories: 400 });
    const totals = sumPortionMacros(result);
    // Chicken at ~400 kcal is ~333g, fat ~8.3g. Should emerge, not be fabricated.
    expect(totals.fat).toBeLessThan(15);
  });

  it("respects veggie/fixed-category grams (vegetables stay around their base)", () => {
    const result = solvePortions([chicken, rice, broccoli], { calories: 700 });
    const broc = result.find((r) => r.ingredient_id === "broccoli_raw")!;
    // Broccoli is in the vegetable category — kept in [80, 160] by the solver
    expect(broc.grams).toBeGreaterThanOrEqual(80);
    expect(broc.grams).toBeLessThanOrEqual(160);
  });

  it("low-kcal meal with limited protein sources still prioritizes kcal over MPS", () => {
    // kcal budget 200 with only broccoli — no way to reach 30g protein. Solver
    // must not bust the kcal budget to hit MPS; the meal just has low protein.
    const result = solvePortions([broccoli], { calories: 200 });
    const totals = sumPortionMacros(result);
    expect(totals.calories).toBeLessThan(220); // kcal is still respected
    // Protein may be well under 30g — that's fine, the UI shows the MPS pill.
    expect(totals.protein).toBeLessThan(30);
  });

  it("accepts default MPS floor of 30g when proteinMpsFloor is omitted", () => {
    const a = solvePortions([chicken, rice], { calories: 700 });
    const b = solvePortions([chicken, rice], { calories: 700, proteinMpsFloor: 30 });
    expect(sumPortionMacros(a).protein).toEqual(sumPortionMacros(b).protein);
  });

  it("can raise the MPS floor for elite-athlete / bulk cases", () => {
    // With a 40g floor, the solver should push protein ≥ 40g when possible.
    const result = solvePortions([chicken, rice, broccoli], {
      calories: 800,
      proteinMpsFloor: 40,
    });
    const totals = sumPortionMacros(result);
    expect(totals.protein).toBeGreaterThanOrEqual(40);
  });

  it("returns one PortionResult per ingredient, each with non-negative grams", () => {
    const result = solvePortions([chicken, rice, broccoli, oliveOil], {
      calories: 700,
    });
    expect(result.length).toBe(4);
    for (const p of result) {
      expect(p.grams).toBeGreaterThanOrEqual(0);
      expect(p.calories).toBeGreaterThanOrEqual(0);
    }
  });
});
