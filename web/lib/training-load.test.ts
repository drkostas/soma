import { describe, it, expect } from "vitest";
import { computeStrengthLoad, estimate1rm, estimateRpe, getRunningRelevance } from "./training-load";
import golden from "./training-load.golden.json";

const g = golden as any;

describe("strength load — Python parity", () => {
  it("estimate1rm (Epley)", () => {
    for (const c of g.e1rm) expect(estimate1rm(c.w, c.r)).toBeCloseTo(c.v, 6);
  });
  it("estimateRpe (RIR-RPE)", () => {
    for (const c of g.rpe) expect(estimateRpe(c.w, c.r, c.o)).toBeCloseTo(c.v, 6);
  });
  it("getRunningRelevance (partial match, ordered)", () => {
    for (const c of g.rel) expect(getRunningRelevance(c.n)).toBe(c.v);
  });
  it("computeStrengthLoad matches golden (load, sRPE, relevance, cross-modal)", () => {
    for (const c of g.compute) {
      const out = computeStrengthLoad(c.in.ex, c.in.dur);
      expect(out.load_value).toBeCloseTo(c.out.load_value, 2);
      expect(out.session_rpe).toBeCloseTo(c.out.session_rpe, 2);
      expect(out.running_relevance).toBeCloseTo(c.out.running_relevance, 4);
      expect(out.cross_modal_load).toBeCloseTo(c.out.cross_modal_load, 2);
    }
  });
});
