import { describe, it, expect } from "vitest";
import { goalPaceSeries } from "./body-comp-pace";

describe("goalPaceSeries (soma#782, web's cumulative-deficit goal pace)", () => {
  it("runs daily from the window start to its end when the window is closed", () => {
    const r = goalPaceSeries(["2026-05-27", "2026-05-29"], { window: { active: false, start: "2026-05-27", end: "2026-05-29", countedDays: 1, label: "x" } as never }, 800, "2026-05-29");
    expect(r.axis).toEqual(["2026-05-27", "2026-05-28", "2026-05-29"]);
    expect(r.pace).toEqual([0, -800, -1600]);
  });
  it("extends 14 days past the last day while the window is active", () => {
    const r = goalPaceSeries(["2026-09-01"], { window: { active: true, start: "2026-09-01", end: "2026-09-01", countedDays: 1, label: "x" } as never }, 500, "2026-09-01");
    expect(r.axis.length).toBe(15);
    expect(r.pace[14]).toBe(-7000);
  });
  it("falls back to the first counted day when the API sends no window, and is empty-safe", () => {
    const r = goalPaceSeries(["2026-03-01", "2026-03-03"], { window: undefined } as never, 800, "2026-03-01");
    expect(r.pace[0]).toBe(0);
    expect(r.pace[r.pace.length - 1]).toBeLessThan(0);
    expect(goalPaceSeries([], { window: undefined } as never, 800, null)).toEqual({ axis: [], pace: [] });
  });
});
