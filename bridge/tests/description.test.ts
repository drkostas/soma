import { describe, it, expect } from "vitest";
import { formatWeight, formatDuration, sliceHrByExercise } from "../src/description";
import golden from "./description.golden.json";

const g = golden as any;

describe("description formatters — Python parity", () => {
  it("formatWeight", () => {
    for (const c of g.weights) expect(formatWeight(c.kg)).toBe(c.out);
  });
  it("formatDuration", () => {
    for (const c of g.durations) expect(formatDuration(c.s)).toBe(c.out);
  });
  it("sliceHrByExercise", () => {
    for (const c of g.hr_slices) {
      const exercises = c.ex_sets.map((n: number) => ({ sets: Array(n).fill(0) }));
      expect(sliceHrByExercise(c.hr, exercises)).toEqual(c.out);
    }
  });
});
