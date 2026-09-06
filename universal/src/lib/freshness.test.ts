import { describe, it, expect } from "vitest";
import { freshness, staleShort, todayKey, RECOVERY_MAX_AGE_DAYS } from "./freshness";

const T = "2026-09-06";
describe("freshness (app twin, #731)", () => {
  it("cadence is two days", () => { expect(RECOVERY_MAX_AGE_DAYS).toBe(2); });
  const cases: [string, string | null, boolean, number | null][] = [
    ["today", "2026-09-06", false, 0],
    ["two days ago still fresh", "2026-09-04", false, 2],
    ["three days ago stale", "2026-09-03", true, 3],
    ["2026-08-23 on 2026-09-06 is 14 days stale", "2026-08-23", true, 14],
    ["timestamp uses its date part", "2026-09-05T02:00:00Z", false, 1],
    ["null is missing and stale", null, true, null],
    ["garbage is stale, not missing", "nope", true, null],
  ];
  for (const [name, obs, stale, age] of cases) {
    it(name, () => { const f = freshness(obs, T); expect(f.stale).toBe(stale); expect(f.ageDays).toBe(age); expect(f.missing).toBe(obs == null); });
  }
  it("short copy names the month-day, or yet", () => {
    expect(staleShort("HRV", freshness("2026-08-21", T))).toBe("no HRV since 08-21");
    expect(staleShort("night", freshness(null, T))).toBe("no night yet");
  });
  it("todayKey is the New York day", () => { expect(todayKey(new Date("2026-09-07T03:30:00Z"))).toBe("2026-09-06"); });
});
