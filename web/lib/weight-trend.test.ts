import { describe, it, expect } from "vitest";
import { computeWeightTrend, WEIGHT_TREND_MIN_POINTS, WEIGHT_TREND_WINDOW_DAYS, type WeighInPoint } from "./weight-trend";

const TODAY = "2026-09-06";
const w = (date: string, weightKg: number): WeighInPoint => ({ date, weightKg });

describe("computeWeightTrend (#702)", () => {
  it("window is 14 days and needs 3 weigh-ins", () => {
    expect(WEIGHT_TREND_WINDOW_DAYS).toBe(14);
    expect(WEIGHT_TREND_MIN_POINTS).toBe(3);
  });

  const noTrend: [string, WeighInPoint[], number, string][] = [
    ["no points → null with a basis that says so", [], 0, "no weigh-ins"],
    ["one point is not a trend", [w("2026-09-06", 80)], 1, "1 weigh-in in"],
    ["two points is not a trend", [w("2026-09-01", 80), w("2026-09-06", 79.5)], 2, "2 weigh-ins in"],
    ["points outside the window do not count", [w("2026-08-01", 82), w("2026-08-10", 81), w("2026-08-20", 80), w("2026-09-06", 79)], 1, "1 weigh-in"],
    ["future-dated points are ignored", [w("2026-09-07", 70), w("2026-09-08", 70), w("2026-09-06", 80)], 1, "1 weigh-in"],
    ["non-positive weights are ignored", [w("2026-09-04", 0), w("2026-09-05", -1), w("2026-09-06", 80)], 1, "1 weigh-in"],
  ];
  for (const [name, pts, wantN, wantBasis] of noTrend) {
    it(name, () => {
      const t = computeWeightTrend(pts, TODAY);
      expect(t.kgPerWindow).toBeNull();
      expect(t.weighIns).toBe(wantN);
      expect(t.basis).toContain(wantBasis);
    });
  }

  it("a clean linear loss reports the change over the window exactly", () => {
    // −0.1 kg/day for 14 days = −1.4 kg over the window
    const pts: WeighInPoint[] = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(Date.UTC(2026, 8, 6 - i)).toISOString().slice(0, 10);
      pts.push(w(d, 80 - 0.1 * (13 - i)));
    }
    const t = computeWeightTrend(pts, TODAY);
    expect(t.kgPerWindow).toBeCloseTo(-1.4, 6);
    expect(t.weighIns).toBe(14);
    expect(t.basis).toBe("-1.4 kg over 14 days (14 weigh-ins)");
    expect(t.from).toBe("2026-08-24");
    expect(t.to).toBe("2026-09-06");
    // oldest day is 80.0; today, 13 days of −0.1, is 78.7
    expect(t.latestKg).toBeCloseTo(78.7, 6);
  });

  it("a gain carries a plus sign", () => {
    const t = computeWeightTrend([w("2026-08-24", 79), w("2026-08-31", 79.5), w("2026-09-06", 80)], TODAY);
    expect(t.kgPerWindow).toBeGreaterThan(0);
    expect(t.basis.startsWith("+")).toBe(true);
  });

  it("three sparse weigh-ins is enough, and OLS is not fooled by one noisy day", () => {
    // Real loss of ~0.5 kg with one water-heavy reading in the middle
    const t = computeWeightTrend([w("2026-08-24", 81.0), w("2026-08-30", 81.4), w("2026-09-06", 80.5)], TODAY);
    expect(t.weighIns).toBe(3);
    expect(t.kgPerWindow).not.toBeNull();
    expect(t.kgPerWindow!).toBeLessThan(0);
    expect(t.kgPerWindow!).toBeGreaterThan(-1.5);
  });

  it("a flat weight is ~0, not null", () => {
    const t = computeWeightTrend([w("2026-08-24", 80), w("2026-08-31", 80), w("2026-09-06", 80)], TODAY);
    expect(t.kgPerWindow).toBe(0);
    expect(t.basis).toContain("0.0 kg");
  });

  it("duplicate dates keep the last value and count once", () => {
    const t = computeWeightTrend([w("2026-09-06", 90), w("2026-09-06", 80), w("2026-08-30", 80.5), w("2026-08-24", 81)], TODAY);
    expect(t.weighIns).toBe(3);
    expect(t.latestKg).toBe(80);
  });

  it("the window edge is inclusive: a weigh-in 13 days ago counts, 14 does not", () => {
    const inside = computeWeightTrend([w("2026-08-24", 81), w("2026-08-30", 80.5), w("2026-09-06", 80)], TODAY);
    expect(inside.weighIns).toBe(3);
    const outside = computeWeightTrend([w("2026-08-23", 81), w("2026-08-30", 80.5), w("2026-09-06", 80)], TODAY);
    expect(outside.weighIns).toBe(2);
  });

  it("the user's actual recent state: an August blackout with no scale either → honest null", () => {
    const t = computeWeightTrend([w("2026-08-05", 80.2)], TODAY);
    expect(t.kgPerWindow).toBeNull();
    expect(t.weighIns).toBe(0);
    expect(t.basis).toBe("no weigh-ins in the last 14 days");
  });
});
