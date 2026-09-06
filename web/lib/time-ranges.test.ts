import { describe, it, expect } from "vitest";
import { parseRangeDays, rangeToDays } from "./time-ranges";

describe("parseRangeDays (#743)", () => {
  const cases: [string | null | undefined, number][] = [
    ["6m", 180], ["1w", 7], ["2w", 14], ["1m", 30], ["3m", 90], ["9m", 270], ["1y", 365], ["2y", 730], ["all", 3650],
    ["7d", 7], ["14d", 14], ["30d", 30], ["90d", 90], ["180d", 180],
    ["bogus", 180], [null, 180], [undefined, 180], ["", 180],
  ];
  for (const [input, want] of cases) {
    it(`${String(input)} → ${want}`, () => { expect(parseRangeDays(input)).toBe(want); });
  }
  it("a custom fallback applies only when the key is unknown", () => {
    expect(parseRangeDays("nope", 30)).toBe(30);
    expect(parseRangeDays("6m", 30)).toBe(180);
  });
  it("agrees with rangeToDays for every web key", () => {
    for (const k of ["1w", "2w", "1m", "3m", "6m", "9m", "1y", "2y", "3y", "all"]) expect(parseRangeDays(k)).toBe(rangeToDays(k));
  });
});
