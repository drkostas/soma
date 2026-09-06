import { describe, it, expect } from "vitest";
import { slotCoverage, meetsCoverageFloor, daysBetween, COVERAGE_FLOOR } from "./coverage";

describe("slotCoverage", () => {
  const cases: [string, string[], string[], number][] = [
    ["nothing logged, nothing skipped", [], [], 0],
    ["breakfast only", ["breakfast"], [], 0.25],
    ["breakfast + lunch", ["breakfast", "lunch"], [], 0.5],
    ["three slots logged", ["breakfast", "lunch", "dinner"], [], 0.75],
    ["all four logged", ["breakfast", "lunch", "dinner", "pre_sleep"], [], 1],
    ["breakfast logged, rest explicitly skipped = complete", ["breakfast"], ["lunch", "dinner", "pre_sleep"], 1],
    ["all skipped = complete (a deliberate fast is real information)", [], ["breakfast", "lunch", "dinner", "pre_sleep"], 1],
    ["logged AND skipped same slot counts once", ["lunch"], ["lunch"], 0.25],
    ["unknown slot names are ignored, not counted", ["breakfast", "during_workout", "snack"], [], 0.25],
    ["null inputs behave as empty", null as unknown as string[], undefined as unknown as string[], 0],
  ];
  for (const [name, logged, skipped, want] of cases) {
    it(name, () => {
      expect(slotCoverage(logged, skipped)).toBeCloseTo(want, 6);
    });
  }
});

describe("meetsCoverageFloor", () => {
  it("floor is 3 of 4, calibrated from the Mar-Apr 2026 active period (#698)", () => {
    expect(COVERAGE_FLOOR).toBe(0.75);
  });
  const cases: [string, number | null | undefined, boolean][] = [
    ["exactly at the floor passes", 0.75, true],
    ["full coverage passes", 1, true],
    ["half coverage fails", 0.5, false],
    ["breakfast-only fails", 0.25, false],
    ["zero fails", 0, false],
    ["null is unknown, not zero, and fails", null, false],
    ["undefined fails", undefined, false],
    ["NaN fails", Number.NaN, false],
  ];
  for (const [name, cov, want] of cases) {
    it(name, () => {
      expect(meetsCoverageFloor(cov)).toBe(want);
    });
  }
});

describe("daysBetween", () => {
  const cases: [string, string, string, number][] = [
    ["same day", "2026-05-01", "2026-05-01", 0],
    ["next day", "2026-05-01", "2026-05-02", 1],
    ["across a month end", "2026-04-30", "2026-05-01", 1],
    ["a week", "2026-05-01", "2026-05-08", 7],
    ["the four-month poison gap, Apr 30 to Sep 6", "2026-04-30", "2026-09-06", 129],
    ["negative when reversed", "2026-05-08", "2026-05-01", -7],
  ];
  for (const [name, a, b, want] of cases) {
    it(name, () => {
      expect(daysBetween(a, b)).toBe(want);
    });
  }
});
