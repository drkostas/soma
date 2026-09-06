import { describe, it, expect } from "vitest";
import { runStatus, RUN_TREND_MIN_RUNS, RUN_LAPSED_DAYS } from "./run-status";

const T = "2026-09-06";
const d = (date: string, load = 60) => ({ date, load });
const daysAgo = (n: number) => { const x = new Date(Date.UTC(2026, 8, 6)); x.setUTCDate(x.getUTCDate() - n); return x.toISOString().slice(0, 10); };

describe("runStatus (#738)", () => {
  it("thresholds: 8 runs in 28 days to call a trend, 14 days without a run is lapsed", () => {
    expect(RUN_TREND_MIN_RUNS).toBe(8);
    expect(RUN_LAPSED_DAYS).toBe(14);
  });

  it("no runs at all → none", () => {
    const s = runStatus([], T);
    expect(s.kind).toBe("none");
    expect(s.label).toBe("No runs in 4 weeks");
    expect(s.acwr).toBeNull();
  });

  it("runs only older than 4 weeks → none, naming the last run", () => {
    const s = runStatus([d("2026-07-01")], T);
    expect(s.kind).toBe("none");
    expect(s.detail).toBe("last run 2026-07-01");
  });

  it("THE case: five short runs in 4 weeks, last one four days ago → Light, not a verdict", () => {
    const s = runStatus([d(daysAgo(4), 81), d(daysAgo(6), 37), d(daysAgo(7), 76), d(daysAgo(11), 54), d(daysAgo(19), 68)], T);
    expect(s.kind).toBe("light");
    expect(s.label).toBe("Light");
    expect(s.runs28).toBe(5);
    expect(s.detail).toBe("5 runs in 4 weeks, too few to call a trend");
    expect(s.lastRun).toBe(daysAgo(4));
    expect(s.daysSinceRun).toBe(4);
  });

  it("last run 15 days ago → lapsed even if the 4-week count is high", () => {
    const runs = Array.from({ length: 10 }, (_, i) => d(daysAgo(15 + i)));
    const s = runStatus(runs, T);
    expect(s.kind).toBe("lapsed");
    expect(s.detail).toContain("15 days ago");
  });

  it("a steady week-in week-out runner reads Steady with ACWR near 1", () => {
    const runs = Array.from({ length: 12 }, (_, i) => d(daysAgo(i * 2 + 1), 60)); // every other day
    const s = runStatus(runs, T);
    expect(s.kind).toBe("steady");
    expect(s.acwr).not.toBeNull();
    expect(s.acwr as number).toBeGreaterThanOrEqual(0.8);
    expect(s.acwr as number).toBeLessThanOrEqual(1.3);
  });

  it("a big last week on a light month reads Spiking", () => {
    const light = Array.from({ length: 6 }, (_, i) => d(daysAgo(10 + i * 3), 30));
    const heavy = Array.from({ length: 5 }, (_, i) => d(daysAgo(i + 1), 120));
    const s = runStatus([...light, ...heavy], T);
    expect(s.runs28).toBe(11);
    expect(s.kind).toBe("spiking");
    expect(s.acwr as number).toBeGreaterThan(1.5);
  });

  it("a quiet last week on a normal month reads Easing off", () => {
    const month = Array.from({ length: 10 }, (_, i) => d(daysAgo(8 + i * 2), 80));
    const s = runStatus([...month, d(daysAgo(2), 20)], T);
    expect(s.kind).toBe("easing");
    expect(s.acwr as number).toBeLessThan(0.8);
  });

  it("future-dated rows are ignored", () => {
    const s = runStatus([d("2026-09-20", 500)], T);
    expect(s.kind).toBe("none");
  });
});
