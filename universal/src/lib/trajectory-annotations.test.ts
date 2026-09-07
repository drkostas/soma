import { describe, it, expect } from "vitest";
import { trajectoryAnnotations } from "./trajectory-annotations";

const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => ({ date: new Date(new Date(from).getTime() + i * 86400000).toISOString().slice(0, 10) }));
const hm = (v: number) => `${v.toFixed(1)}v`;

describe("trajectoryAnnotations (#776)", () => {
  it("draws A/B goal zones and A/B/C tier lines from the goal VDOT", () => {
    const a = trajectoryAnnotations(days("2026-03-01", 30), { goalVdot: 52, raceDate: null, today: "2026-03-10", hmTime: hm });
    expect(a.refAreas.map((r) => [r.y1, r.y2])).toEqual([[50, 52], [48.5, 50]]);
    expect(a.refLines.map((l) => [l.y, l.label])).toEqual([[52, "A (52.0v)"], [50, "B (50.0v)"], [48.5, "C (48.5v)"]]);
    expect(a.hasRace).toBe(false); expect(a.xBands).toEqual([]);
  });
  it("places Today and Race on the date index and the 12-day taper band before the race", () => {
    const a = trajectoryAnnotations(days("2026-03-01", 45), { goalVdot: null, raceDate: "2026-04-12", today: "2026-03-20", hmTime: hm });
    expect(a.xLines).toEqual([{ i: 19, color: "#e0c458" }, { i: 42, color: "#c084fc", dashed: true }]);
    expect(a.xBands).toEqual([{ i0: 30, i1: 42, color: "#8b9df0", opacity: 0.12 }]);
    expect(a.hasTaper).toBe(true); expect(a.refLines).toEqual([]);
  });
  it("is empty-safe: no plan, no points → nothing to draw", () => {
    const a = trajectoryAnnotations([], { goalVdot: null, raceDate: null, today: "2026-09-07", hmTime: hm });
    expect(a).toEqual({ refAreas: [], refLines: [], xLines: [], xBands: [], hasToday: false, hasRace: false, hasTaper: false });
  });
  it("skips the race line when the race is beyond the trajectory window", () => {
    const a = trajectoryAnnotations(days("2026-03-01", 10), { goalVdot: 50, raceDate: "2026-06-01", today: "2026-03-05", hmTime: hm });
    expect(a.hasRace).toBe(false); expect(a.xLines).toEqual([{ i: 4, color: "#e0c458" }]);
  });
});
