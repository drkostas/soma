import { describe, it, expect } from "vitest";
import { zScore, computeReadiness } from "./readiness-stream";
import golden from "./readiness-stream.golden.json";

const g = golden as any;

describe("readiness stream — Python parity", () => {
  it("zScore (population std, 0 on <7 / zero-std)", () => {
    for (const c of g.z_score) expect(zScore(c.in.v, c.in.b)).toBeCloseTo(c.v, 8);
  });

  it("computeReadiness (composite, traffic light, flags, overrides)", () => {
    for (const c of g.readiness) {
      const out = computeReadiness(c.in);
      expect(out.composite_score).toBeCloseTo(c.v.composite_score, 4);
      expect(out.traffic_light).toBe(c.v.traffic_light);
      expect(out.flags).toEqual(c.v.flags);
      expect(out.hrv_z_score).toBe(c.v.hrv_z_score);
      expect(out.rhr_z_score).toBe(c.v.rhr_z_score);
    }
  });
});
