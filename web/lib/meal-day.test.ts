import { describe, it, expect } from "vitest";
import { readDayOffset, MAX_DAYS_BACK } from "./nutrition-agent";
import { dayBack } from "./meal-worker";

describe("readDayOffset", () => {
  it("reads the ordinary cases", () => {
    expect(readDayOffset(0)).toBe(0);
    expect(readDayOffset(1)).toBe(1);
    expect(readDayOffset(7)).toBe(7);
  });

  it("⛔ never places a meal in the future", () => {
    expect(readDayOffset(-1)).toBe(0);
    expect(readDayOffset(-99)).toBe(0);
  });

  it("never goes further back than the bound", () => {
    expect(readDayOffset(8)).toBe(MAX_DAYS_BACK);
    expect(readDayOffset(400)).toBe(MAX_DAYS_BACK);
  });

  it("treats a missing or unreadable day as today, rather than losing the meal", () => {
    expect(readDayOffset(undefined)).toBe(0);
    expect(readDayOffset(null)).toBe(0);
    expect(readDayOffset("yesterday")).toBe(0);
    expect(readDayOffset("")).toBe(0);
    expect(readDayOffset(NaN)).toBe(0);
  });

  it("rounds, because a schema can be satisfied by 1.4", () => {
    expect(readDayOffset(1.4)).toBe(1);
    expect(readDayOffset(0.6)).toBe(1);
  });
});

describe("dayBack", () => {
  it("is the same day at zero", () => {
    expect(dayBack("2026-09-22", 0)).toBe("2026-09-22");
  });

  it("counts back, which is the whole bug this fixes", () => {
    expect(dayBack("2026-09-22", 1)).toBe("2026-09-21");
    expect(dayBack("2026-09-22", 7)).toBe("2026-09-15");
  });

  it("crosses a month and a year without help", () => {
    expect(dayBack("2026-09-01", 1)).toBe("2026-08-31");
    expect(dayBack("2026-03-01", 1)).toBe("2026-02-28");
    expect(dayBack("2026-01-01", 1)).toBe("2025-12-31");
  });

  it("⛔ does its arithmetic in UTC, so a calendar day cannot slip a timezone", () => {
    // Built as a local date, 2026-09-22 in Athens is 2026-09-21T21:00Z, and taking a day off that
    // then formatting in UTC would give 2026-09-20: one day too far back, only east of Greenwich.
    expect(dayBack("2026-09-22", 1)).toBe("2026-09-21");
    expect(dayBack("2026-06-15", 1)).toBe("2026-06-14");
  });

  it("returns the date unchanged when it cannot be read", () => {
    expect(dayBack("not a date", 1)).toBe("not a date");
  });
});
