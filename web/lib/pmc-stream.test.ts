import { describe, it, expect } from "vitest";
import { computeActivityLoad, computeTrimp, computePmc, crossModalScale } from "./pmc-stream";
import golden from "./pmc-stream.golden.json";

const g = golden as any;

describe("load stream / PMC — Python parity", () => {
  it("computeActivityLoad (EPOC primary, duration estimate fallback)", () => {
    for (const c of g.activity_load) {
      const out = computeActivityLoad(c.in.raw, c.in.src);
      expect(out.load_metric).toBe(c.out.load_metric);
      expect(out.load_value).toBeCloseTo(c.out.load_value, 6);
      expect(out.source).toBe(c.out.source);
    }
  });

  it("computeTrimp (Banister, null on missing HR, clamp)", () => {
    for (const c of g.trimp) {
      const out = computeTrimp(c.in.dur, c.in.avg, c.in.rest, c.in.max);
      if (c.out === null) expect(out).toBeNull();
      else expect(out as number).toBeCloseTo(c.out, 6);
    }
  });

  it("computePmc (EWMA CTL/ATL/TSB)", () => {
    const loads = g.pmc.map((e: any, i: number): [string, number] => [g.pmc_dates[i], e.daily_load]);
    const out = computePmc(loads);
    expect(out.length).toBe(g.pmc.length);
    for (let i = 0; i < out.length; i++) {
      expect(out[i].date).toBe(g.pmc[i].date);
      expect(out[i].ctl).toBeCloseTo(g.pmc[i].ctl, 2);
      expect(out[i].atl).toBeCloseTo(g.pmc[i].atl, 2);
      expect(out[i].tsb).toBeCloseTo(g.pmc[i].tsb, 2);
    }
  });

  it("crossModalScale (per-source factor)", () => {
    for (const c of g.scale) expect(crossModalScale(c.s)).toBeCloseTo(c.v, 6);
  });
});
