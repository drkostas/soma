import { describe, it, expect } from "vitest";
import { countDeficitDuration, buildDayPoints } from "./adaptive-tdee";

type Row = Parameters<typeof countDeficitDuration>[0][number];

function day(date: string, o: Partial<Row> = {}): Row {
  return {
    date,
    actual_calories: 2000,
    tdee_used: 2800,
    target_calories: 2000,
    deficit_used: 800,
    is_diet_break: false,
    is_refeed: false,
    status: "closed",
    ...o,
  } as Row;
}

describe("countDeficitDuration", () => {
  it("counts consecutive closed deficit days from the end", () => {
    const rows = [day("2026-07-10"), day("2026-07-11"), day("2026-07-12")];
    expect(countDeficitDuration(rows)).toBe(3);
  });

  it("stops at a diet break", () => {
    const rows = [day("2026-07-10"), day("2026-07-11", { is_diet_break: true }), day("2026-07-12")];
    expect(countDeficitDuration(rows)).toBe(1); // only the last day
  });

  it("stops at a refeed", () => {
    const rows = [day("2026-07-10"), day("2026-07-11", { is_refeed: true }), day("2026-07-12")];
    expect(countDeficitDuration(rows)).toBe(1);
  });

  it("stops at a surplus (no deficit)", () => {
    const rows = [day("2026-07-11", { deficit_used: 0 }), day("2026-07-12")];
    expect(countDeficitDuration(rows)).toBe(1);
  });

  it("skips not-yet-closed days without breaking the streak", () => {
    const rows = [day("2026-07-10"), day("2026-07-11", { status: "open" }), day("2026-07-12")];
    expect(countDeficitDuration(rows)).toBe(2);
  });
});

describe("buildDayPoints", () => {
  it("forward-fills weight and skips days before the first weigh-in", () => {
    const rows = [day("2026-07-10"), day("2026-07-11"), day("2026-07-12")];
    const weights = [{ date: "2026-07-11", weightKg: 80 }];
    const pts = buildDayPoints(rows, weights);
    // 2026-07-10 skipped (no weigh-in yet), 11 and 12 carry 80
    expect(pts.map((p) => p.weightKg)).toEqual([80, 80]);
    expect(pts.map((p) => p.intakeKcal)).toEqual([2000, 2000]);
  });

  it("carries a weigh-in that predates the day rows (date-misaligned)", () => {
    const rows = [day("2026-07-10"), day("2026-07-12")];
    const pts = buildDayPoints(rows, [{ date: "2026-07-08", weightKg: 81 }]);
    expect(pts.map((p) => p.weightKg)).toEqual([81, 81]);
  });

  it("skips non-closed and zero-intake days", () => {
    const rows = [
      day("2026-07-10", { status: "open" }),
      day("2026-07-11", { actual_calories: 0 }),
      day("2026-07-12"),
    ];
    const pts = buildDayPoints(rows, [{ date: "2026-07-09", weightKg: 80 }]);
    expect(pts).toHaveLength(1);
    expect(pts[0].intakeKcal).toBe(2000);
  });

  it("reconstructs tdee from target + deficit when tdee_used is null", () => {
    const rows = [day("2026-07-12", { tdee_used: null, target_calories: 1900, deficit_used: 700 })];
    const pts = buildDayPoints(rows, [{ date: "2026-07-12", weightKg: 79 }]);
    expect(pts[0].tdeeKcal).toBe(2600);
  });
});
