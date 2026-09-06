import { describe, it, expect } from "vitest";
import { hrAgeLabel, hrAgeTone, HR_STALE_SECONDS } from "./hr-freshness";

describe("hr-freshness (#668)", () => {
  it("five minutes is the line", () => { expect(HR_STALE_SECONDS).toBe(300); });
  const cases: [number | null, string, string][] = [
    [null, "fresh", ""],
    [30, "fresh", "just now"],
    [119, "fresh", "just now"],
    [180, "fresh", "3m ago"],
    [300, "fresh", "5m ago"],
    [301, "stale", "5m ago · stale"],
    [900, "stale", "15m ago · stale"],
    [3599, "stale", "60m ago · stale"],
    [3600, "old", "1h ago · stale"],
    [3601, "old", "1h ago · stale"],
    [86400, "old", "24h ago · stale"],
  ];
  for (const [age, tone, label] of cases) {
    it(`${age}s → ${tone} "${label}"`, () => {
      expect(hrAgeTone(age)).toBe(tone);
      expect(hrAgeLabel(age)).toBe(label);
    });
  }
});
