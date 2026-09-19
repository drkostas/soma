import { describe, it, expect } from "vitest";
import { renderContext, type AgentContext } from "./nutrition-agent-context";

const CTX: AgentContext = {
  date: "2026-09-19", slot: "dinner", weightKg: 73.2,
  slotBudgetKcal: 640, dayRemainingKcal: 900,
  presets: [{ id: "p1", name: "Regular omelette plate", slot: "breakfast", calories: 430, protein: 34, carbs: 12, fat: 26, fiber: 3 }],
  ingredients: [
    { id: "chicken_breast_raw", name: "Chicken Breast (raw)", category: "protein", unit: "g", grams_per_unit: null, small: 104, usual: 150, large: 208, n: 25 },
    { id: "eggs_whole", name: "Eggs (whole)", category: "protein", unit: "egg", grams_per_unit: 50, small: 50, usual: 100, large: 150, n: 12 },
  ],
};

describe("renderContext", () => {
  it("states the day, the slot and what is left", () => {
    const s = renderContext(CTX);
    expect(s).toContain("2026-09-19");
    expect(s).toContain("dinner");
    expect(s).toContain("640");
    expect(s).toContain("73.2");
  });

  it("lists every ingredient with the owner's own small, usual and large", () => {
    const s = renderContext(CTX);
    expect(s).toMatch(/chicken_breast_raw.*104.*150.*208/);
  });

  it("lists the presets by name so a regular meal can be recognised", () => {
    expect(renderContext(CTX)).toContain("Regular omelette plate");
  });

  it("marks a unit-based food with its grams per unit", () => {
    expect(renderContext(CTX)).toMatch(/eggs_whole.*egg.*50/);
  });

  it("says so plainly when there are no presets, rather than leaving a blank", () => {
    expect(renderContext({ ...CTX, presets: [] })).toContain("none saved");
  });

  it("leaves the weight line out when there is no weigh-in", () => {
    expect(renderContext({ ...CTX, weightKg: null })).not.toContain("body weight");
  });
});
