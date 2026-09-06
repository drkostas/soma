import { describe, it, expect } from "vitest";
import { freshness, staleHeadline, todayKey, RECOVERY_MAX_AGE_DAYS } from "./freshness";

const T = "2026-09-06";

describe("freshness (#731)", () => {
  it("two days is the recovery cadence", () => {
    expect(RECOVERY_MAX_AGE_DAYS).toBe(2);
  });

  const cases: [string, string | null | undefined, boolean, number | null][] = [
    ["today is fresh", "2026-09-06", false, 0],
    ["yesterday is fresh", "2026-09-05", false, 1],
    ["two days ago is still fresh (a late sync is not shouted about)", "2026-09-04", false, 2],
    ["three days ago is stale", "2026-09-03", true, 3],
    ["THE case: 2026-08-23 on 2026-09-06 is stale by 14 days", "2026-08-23", true, 14],
    ["a timestamp is read by its date part", "2026-09-06T03:12:00.000Z", false, 0],
    ["a future date (clock skew) is fresh, not stale", "2026-09-07", false, -1],
    ["null is missing and stale", null, true, null],
    ["undefined is missing and stale", undefined, true, null],
    ["garbage is stale but not missing", "not-a-date", true, null],
  ];
  for (const [name, observed, stale, age] of cases) {
    it(name, () => {
      const f = freshness(observed, T);
      expect(f.stale).toBe(stale);
      expect(f.ageDays).toBe(age);
      expect(f.missing).toBe(observed == null);
    });
  }

  it("a custom cadence moves the line", () => {
    expect(freshness("2026-09-03", T, 3).stale).toBe(false);
    expect(freshness("2026-09-02", T, 3).stale).toBe(true);
  });

  it("headlines name the date, or say yet when nothing was ever observed", () => {
    expect(staleHeadline("night", freshness("2026-08-23", T))).toBe("No night recorded since 2026-08-23");
    expect(staleHeadline("HRV reading", freshness("2026-08-21", T))).toBe("No HRV reading since 2026-08-21");
    expect(staleHeadline("SpO2 reading", freshness(null, T))).toBe("No SpO2 reading yet");
    expect(staleHeadline("night", freshness(null, T))).toBe("No night recorded yet");
  });

  it("todayKey uses the New York day boundary", () => {
    expect(todayKey(new Date("2026-09-07T03:30:00Z"))).toBe("2026-09-06");
    expect(todayKey(new Date("2026-09-07T12:00:00Z"))).toBe("2026-09-07");
  });
});
