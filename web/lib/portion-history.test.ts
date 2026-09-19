import { describe, it, expect } from "vitest";
import { bandFor, GENERIC_BANDS, MIN_OBSERVATIONS, type PortionBand } from "./portion-history";

describe("bandFor", () => {
  const own = new Map<string, PortionBand>([
    ["chicken_breast_raw", { small: 104, usual: 150, large: 208, n: 25 }],
    ["chia_seeds", { small: 10, usual: 15, large: 20, n: 2 }],
  ]);

  it("uses the owner's own numbers once there are enough of them", () => {
    expect(bandFor(own, "chicken_breast_raw", "protein")).toEqual({ small: 104, usual: 150, large: 208, n: 25 });
  });

  it("falls back to the category when the food has been logged fewer than four times", () => {
    // Two observations is a coincidence, not a habit.
    expect(bandFor(own, "chia_seeds", "fat")).toEqual(GENERIC_BANDS.fat);
    expect(MIN_OBSERVATIONS).toBe(4);
  });

  it("falls back to the category for a food never logged at all", () => {
    expect(bandFor(own, "quinoa_raw", "carbs")).toEqual(GENERIC_BANDS.carbs);
  });

  it("falls back to a neutral band for a category it does not know", () => {
    expect(bandFor(own, "mystery", "not_a_category")).toEqual(GENERIC_BANDS.default);
  });

  it("keeps large clear of usual in every category, or the word means nothing", () => {
    for (const [name, b] of Object.entries(GENERIC_BANDS)) {
      expect(b.small, name).toBeLessThanOrEqual(b.usual);
      expect(b.large, name).toBeGreaterThan(b.usual);
    }
  });
});
