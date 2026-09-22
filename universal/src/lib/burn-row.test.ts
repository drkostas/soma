import { describe, it, expect } from "vitest";
import { runKcal, runIsPlanned, runPredictionNote } from "./burn-row";

// His real day: a 3.09 km run that Garmin scored at 222 kcal, with no prediction because the plan
// had finished. The API sends runActual as a boolean and the calories in runCalories.
const realDay = { runActual: true, runCalories: 222, runPredicted: 0 };

describe("runKcal", () => {
  it("shows what he actually burned", () => {
    expect(runKcal(realDay)).toBe(222);
  });

  it("⛔ NEVER renders the flag as the figure, which is how 222 became 1", () => {
    // Number(true) is 1. This is the whole bug, so it is asserted directly.
    expect(runKcal(realDay)).not.toBe(1);
    // And a flag arriving in the figure's place from an older build is refused.
    expect(runKcal({ runActual: true } as never)).toBe(0);
    expect(runKcal({ runCalories: true as unknown as number })).toBe(0);
  });

  it("falls back to the prediction before the run happens", () => {
    expect(runKcal({ runActual: false, runPredicted: 310 })).toBe(310);
  });

  it("is zero, not NaN, when there is nothing", () => {
    expect(runKcal(undefined)).toBe(0);
    expect(runKcal(null)).toBe(0);
    expect(runKcal({})).toBe(0);
  });
});

describe("runIsPlanned", () => {
  it("is done when the flag says so", () => {
    expect(runIsPlanned(realDay)).toBe(false);
    expect(runIsPlanned({ runActual: false, runPredicted: 310 })).toBe(true);
    expect(runIsPlanned(undefined)).toBe(true);
  });
});

describe("runPredictionNote", () => {
  it("says nothing when there was no prediction to compare against", () => {
    expect(runPredictionNote(realDay)).toBeNull();
  });

  it("says nothing before the run, because the figure already IS the prediction", () => {
    expect(runPredictionNote({ runActual: false, runPredicted: 310 })).toBeNull();
  });

  it("compares only when they differ", () => {
    expect(runPredictionNote({ runActual: true, runCalories: 222, runPredicted: 310 })).toBe("~310 kcal predicted");
    expect(runPredictionNote({ runActual: true, runCalories: 310, runPredicted: 310 })).toBeNull();
  });
});
