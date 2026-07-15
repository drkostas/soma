import { describe, it, expect } from "vitest";
import { computeWeightEma } from "./body-comp-stream";
import golden from "./body-comp-stream.golden.json";

const g = golden as any;

describe("body-comp stream — Python parity", () => {
  const check = (key: string) => {
    const cases = g[key];
    const weights = cases.map((c: any): [string, number] => [c.date, c.weight_raw]);
    const span = key === "ema_span3" ? 3 : 7;
    const out = computeWeightEma(weights, span);
    expect(out.length).toBe(cases.length);
    for (let i = 0; i < out.length; i++) {
      expect(out[i].date).toBe(cases[i].date);
      expect(out[i].weight_ema).toBeCloseTo(cases[i].weight_ema, 2);
      expect(out[i].weight_raw).toBeCloseTo(cases[i].weight_raw, 6);
    }
  };
  it("EMA span 7", () => check("ema_span7"));
  it("EMA single point", () => check("ema_single"));
  it("EMA sparse dates", () => check("ema_sparse"));
  it("EMA span 3", () => check("ema_span3"));
});
