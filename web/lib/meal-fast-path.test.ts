import { describe, it, expect } from "vitest";
import { fastParse, type CatalogEntry } from "./meal-fast-path";

const CATALOG: CatalogEntry[] = [
  { id: "chicken_breast_raw", name: "Chicken Breast (raw)" },
  { id: "white_rice_raw", name: "White Rice (raw)" },
  { id: "eggs_whole", name: "Eggs (whole)" },
  { id: "olive_oil", name: "Olive Oil" },
  { id: "bread_whole_wheat", name: "Bread (whole wheat)" },
];

describe("fastParse — claims only what it cannot get wrong", () => {
  it("reads a sentence where every food carries its own amount", () => {
    const r = fastParse("200g chicken breast, 100 g white rice", CATALOG)!;
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ ingredient_id: "chicken_breast_raw", quantity: { kind: "grams", value: 200 } });
    expect(r[1]).toMatchObject({ ingredient_id: "white_rice_raw", quantity: { kind: "grams", value: 100 } });
  });

  it("reads counts", () => {
    const r = fastParse("3 eggs", CATALOG)!;
    expect(r[0]).toMatchObject({ ingredient_id: "eggs_whole", quantity: { kind: "count", value: 3 } });
  });

  it("reads bites", () => {
    const r = fastParse("3 bites of bread whole wheat", CATALOG)!;
    expect(r[0]).toMatchObject({ ingredient_id: "bread_whole_wheat", quantity: { kind: "bites", value: 3 } });
  });

  it("reads a portion word attached to its own food", () => {
    const r = fastParse("large chicken breast, small white rice", CATALOG)!;
    expect(r[0].quantity).toEqual({ kind: "portion", value: "large" });
    expect(r[1].quantity).toEqual({ kind: "portion", value: "small" });
  });

  it("refuses a portion word that belongs to the whole meal", () => {
    // "large portion" describes the meal, not the rice. Ambiguous, so the agent decides.
    expect(fastParse("chicken and rice, large portion", CATALOG)).toBeNull();
  });

  it("refuses a food it does not know exactly", () => {
    expect(fastParse("200g chicken brest", CATALOG)).toBeNull();
    expect(fastParse("200g quinoa", CATALOG)).toBeNull();
  });

  it("refuses when any fragment has no amount", () => {
    expect(fastParse("200g chicken breast, white rice", CATALOG)).toBeNull();
  });

  it("refuses a stated total, a named regular meal, or hedged prose", () => {
    expect(fastParse("the whole plate was 600g, chicken and rice", CATALOG)).toBeNull();
    expect(fastParse("I ate my regular omelette plate", CATALOG)).toBeNull();
    expect(fastParse("about 200g chicken breast", CATALOG)).toBeNull();
    expect(fastParse("some chicken breast", CATALOG)).toBeNull();
  });

  it("refuses an empty or wordless sentence", () => {
    expect(fastParse("", CATALOG)).toBeNull();
    expect(fastParse("   ", CATALOG)).toBeNull();
    expect(fastParse("mmm", CATALOG)).toBeNull();
  });

  it("marks everything it claims as coming from the catalog, with no doubt", () => {
    const r = fastParse("200g chicken breast", CATALOG)!;
    expect(r[0].source).toBe("catalog");
    expect(r[0].confidence).toBe(1);
    expect(r[0].note).toBeNull();
  });
});
