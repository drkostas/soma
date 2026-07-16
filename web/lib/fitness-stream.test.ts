import { describe, it, expect } from "vitest";
import {
  computeEfficiencyFactor, computeDecoupling, extractVo2max, aggregateLaps, splitIntoHalves,
} from "./fitness-stream";
import golden from "./fitness-stream.golden.json";

const g = golden as any;

describe("fitness stream — Python parity", () => {
  it("computeEfficiencyFactor", () => {
    for (const c of g.ef) expect(computeEfficiencyFactor(c.p, c.h)).toBeCloseTo(c.v, 12);
  });
  it("computeDecoupling", () => {
    for (const c of g.decoupling) expect(computeDecoupling(c.a, c.b)).toBeCloseTo(c.v, 8);
  });
  it("extractVo2max (list/dict, generic/top-level, missing)", () => {
    for (const c of g.vo2) {
      const out = extractVo2max(c.in);
      if (c.v === null) expect(out).toBeNull();
      else expect(out as number).toBeCloseTo(c.v, 8);
    }
  });
  it("splitIntoHalves (lapDTOs + splitSummaries)", () => {
    for (const c of g.halves) {
      const out = splitIntoHalves(c.in);
      expect(out).not.toBeNull();
      const [f, s] = out as any;
      expect(f.pace_sec_km).toBeCloseTo(c.v[0].pace_sec_km, 8);
      expect(f.avg_hr).toBeCloseTo(c.v[0].avg_hr, 8);
      expect(s.pace_sec_km).toBeCloseTo(c.v[1].pace_sec_km, 8);
      expect(s.avg_hr).toBeCloseTo(c.v[1].avg_hr, 8);
    }
  });
  it("aggregateLaps (null on empty)", () => {
    for (const c of g.aggregate) {
      const out = aggregateLaps(c.in);
      if (c.v === null) expect(out).toBeNull();
      else {
        expect(out!.pace_sec_km).toBeCloseTo(c.v.pace_sec_km, 8);
        expect(out!.avg_hr).toBeCloseTo(c.v.avg_hr, 8);
      }
    }
  });
});
