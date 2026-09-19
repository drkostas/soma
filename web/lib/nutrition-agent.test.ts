import { describe, it, expect } from "vitest";
import { parseProposal, MEAL_PROPOSAL_SCHEMA, SLOTS } from "./nutrition-agent";

const GOOD = {
  slot: "dinner", tense: "eaten", preset_name: null, total_grams: null,
  items: [{
    query: "chicken breast", ingredient_id: "chicken_breast_raw",
    quantity: { kind: "grams", value: 200 }, note: null,
    macros_per_100g: null, source: "catalog", confidence: 0.95,
  }],
  summary: "Logged dinner: 200g chicken.", question: null,
};

describe("parseProposal", () => {
  it("accepts a well-formed proposal", () => {
    const p = parseProposal(GOOD)!;
    expect(p.items[0].quantity).toEqual({ kind: "grams", value: 200 });
    expect(p.slot).toBe("dinner");
    expect(p.tense).toBe("eaten");
  });

  it("refuses a slot soma does not have", () => {
    expect(parseProposal({ ...GOOD, slot: "snack" })).toBeNull();
    expect(SLOTS).not.toContain("snack");
  });

  it("refuses a quantity kind it does not know", () => {
    expect(parseProposal({ ...GOOD, items: [{ ...GOOD.items[0], quantity: { kind: "handful", value: 2 } }] })).toBeNull();
  });

  it("refuses a portion word it does not know", () => {
    expect(parseProposal({ ...GOOD, items: [{ ...GOOD.items[0], quantity: { kind: "portion", value: "enormous" } }] })).toBeNull();
  });

  it("accepts the three portion words", () => {
    for (const v of ["small", "moderate", "large"]) {
      expect(parseProposal({ ...GOOD, items: [{ ...GOOD.items[0], quantity: { kind: "portion", value: v } }] })).not.toBeNull();
    }
  });

  it("accepts unknown, which carries no value", () => {
    const p = parseProposal({ ...GOOD, items: [{ ...GOOD.items[0], quantity: { kind: "unknown" } }] })!;
    expect(p.items[0].quantity).toEqual({ kind: "unknown" });
  });

  it("refuses a share_of_total with no total to divide", () => {
    expect(parseProposal({
      ...GOOD, total_grams: null,
      items: [{ ...GOOD.items[0], quantity: { kind: "share_of_total", value: 0.5 } }],
    })).toBeNull();
  });

  it("accepts a share_of_total when a total was given", () => {
    const p = parseProposal({
      ...GOOD, total_grams: 600,
      items: [{ ...GOOD.items[0], quantity: { kind: "share_of_total", value: 0.5 } }],
    })!;
    expect(p.total_grams).toBe(600);
  });

  it("refuses an unmatched food with no macros to fall back on", () => {
    expect(parseProposal({
      ...GOOD, items: [{ ...GOOD.items[0], ingredient_id: null, macros_per_100g: null }],
    })).toBeNull();
  });

  it("accepts an unmatched food that brought its own macros", () => {
    const p = parseProposal({
      ...GOOD,
      items: [{ ...GOOD.items[0], ingredient_id: null, source: "estimate", confidence: 0.5,
                macros_per_100g: { calories: 140, protein: 9, carbs: 18, fat: 4, fiber: 2 } }],
    })!;
    expect(p.items[0].macros_per_100g?.calories).toBe(140);
  });

  it("refuses a negative macro, which is never a real food", () => {
    expect(parseProposal({
      ...GOOD,
      items: [{ ...GOOD.items[0], ingredient_id: null,
                macros_per_100g: { calories: 140, protein: -9, carbs: 18, fat: 4, fiber: 2 } }],
    })).toBeNull();
  });

  it("clamps a confidence outside 0 to 1 rather than trusting it", () => {
    expect(parseProposal({ ...GOOD, items: [{ ...GOOD.items[0], confidence: 4 }] })!.items[0].confidence).toBe(1);
    expect(parseProposal({ ...GOOD, items: [{ ...GOOD.items[0], confidence: -2 }] })!.items[0].confidence).toBe(0);
  });

  it("refuses rubbish", () => {
    expect(parseProposal(null)).toBeNull();
    expect(parseProposal("hello")).toBeNull();
    expect(parseProposal({ ...GOOD, items: [] })).toBeNull();
    expect(parseProposal({ ...GOOD, items: "not an array" })).toBeNull();
  });

  it("publishes a schema naming every quantity kind and every slot", () => {
    const s = JSON.stringify(MEAL_PROPOSAL_SCHEMA);
    for (const k of ["grams", "count", "portion", "share_of_total", "bites", "unknown"]) expect(s).toContain(k);
    for (const slot of SLOTS) expect(s).toContain(slot);
  });
});
