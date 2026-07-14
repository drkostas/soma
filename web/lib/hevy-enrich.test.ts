import { describe, it, expect } from "vitest";
import { resolveHrDecision, filterHrInWindow, windowDates } from "./hevy-enrich";
import golden from "./hevy-enrich.golden.json";

const g = golden as any;

describe("resolveHrDecision — Python parity (resolve_hr_samples decision)", () => {
  it("matches Python across all branches (daily / avg_N / static, round-half-even)", () => {
    for (const c of g.cases) {
      const out = resolveHrDecision(c.in.daily, c.in.recent);
      expect(out.source).toBe(c.out.source);
      expect(out.samples).toEqual(c.out.samples);
    }
  });
});

describe("filterHrInWindow", () => {
  const raw = { heartRateValues: [[1000, 120], [2000, null], [3000, 130], [9999, 140]] };
  it("keeps in-window non-null entries, truncates to int", () => {
    expect(filterHrInWindow([raw], 1000, 3000)).toEqual([120, 130]);
  });
  it("merges multiple raw rows and skips malformed entries", () => {
    const raw2 = { heartRateValues: [[2500, 125.7], [4000, 150]] };
    expect(filterHrInWindow([raw, raw2], 1000, 3000)).toEqual([120, 130, 125]);
  });
  it("empty on no heartRateValues", () => {
    expect(filterHrInWindow([{}], 0, 9999)).toEqual([]);
  });
});

describe("windowDates", () => {
  it("returns day-before, day-of, day-after in UTC", () => {
    expect(windowDates("2026-07-13T10:00:00Z")).toEqual(["2026-07-12", "2026-07-13", "2026-07-14"]);
  });
  it("handles month boundary", () => {
    expect(windowDates("2026-08-01T00:30:00Z")).toEqual(["2026-07-31", "2026-08-01", "2026-08-02"]);
  });
});
