import { describe, it, expect } from "vitest";
import { toReadings, historyWindow, HISTORY_ORIGIN, PAIR_WINDOW_MS } from "./health-connect-weight";

describe("historyWindow", () => {
  it("⛔ always starts at the origin, never at a watermark", () => {
    // He asked for the full history. A watermark would permanently miss anything Arboleaf
    // backfills with an old date, which is the case that matters: a month of weigh-ins already
    // exists inside its app and has never left.
    const a = historyWindow(new Date("2026-09-24T18:00:00Z"));
    const b = historyWindow(new Date("2026-12-31T18:00:00Z"));
    expect(a.startTime).toBe(HISTORY_ORIGIN);
    expect(b.startTime).toBe(HISTORY_ORIGIN);
    expect(a.endTime).toBe("2026-09-24T18:00:00.000Z");
  });

  it("reaches back before any scale he has owned", () => {
    // His last body-composition readings came from an Index scale and stopped in April 2022.
    expect(Date.parse(HISTORY_ORIGIN)).toBeLessThan(Date.parse("2021-01-01T00:00:00Z"));
  });
});

describe("toReadings", () => {
  const w = (id: string, time: string, kg: number) => ({ metadata: { id }, time, weight: { inKilograms: kg } });

  it("pairs the body fat written by the same step on the scale", () => {
    const r = toReadings(
      [w("a", "2026-09-24T06:00:00.000Z", 73.4)],
      [{ time: "2026-09-24T06:00:02.000Z", percentage: 18.2 }],
    );
    expect(r).toEqual([{ externalId: "a", at: "2026-09-24T06:00:00.000Z", weightKg: 73.4, bodyFatPct: 18.2, source: "HEALTH_CONNECT" }]);
  });

  it("takes the nearest body fat when a day has two weigh-ins", () => {
    const r = toReadings(
      [w("a", "2026-09-24T06:00:00.000Z", 73.4), w("b", "2026-09-24T19:00:00.000Z", 74.1)],
      [
        { time: "2026-09-24T06:00:01.000Z", percentage: 18.2 },
        { time: "2026-09-24T19:00:01.000Z", percentage: 18.9 },
      ],
    );
    expect(r.map((x) => x.bodyFatPct)).toEqual([18.2, 18.9]);
  });

  it("leaves body fat null when nothing was measured near it", () => {
    const r = toReadings(
      [w("a", "2026-09-24T06:00:00.000Z", 73.4)],
      [{ time: "2026-09-24T09:00:00.000Z", percentage: 18.2 }],
    );
    expect(r[0].bodyFatPct).toBeNull();
    expect(PAIR_WINDOW_MS).toBeLessThan(10 * 60 * 1000);
  });

  it("⛔ skips an unusable record rather than sending a zero", () => {
    const r = toReadings([
      { metadata: { id: "a" }, time: "2026-09-24T06:00:00.000Z", weight: {} },
      { metadata: { id: "b" }, time: "not a date", weight: { inKilograms: 73 } },
      { metadata: { id: "c" }, time: "2026-09-24T06:00:00.000Z" },
      w("d", "2026-09-24T07:00:00.000Z", 73.4),
    ]);
    expect(r.map((x) => x.externalId)).toEqual(["d"]);
  });

  it("carries Health Connect's record id, which is what makes re-reading safe", () => {
    expect(toReadings([w("hc-uuid-1", "2026-09-24T06:00:00.000Z", 73.4)])[0].externalId).toBe("hc-uuid-1");
    // A record with no id still goes, and the server's older unique key catches a repeat.
    expect(toReadings([{ time: "2026-09-24T06:00:00.000Z", weight: { inKilograms: 73.4 } }])[0].externalId).toBeNull();
  });

  it("returns the backlog oldest first, so a partial send walks forwards", () => {
    const r = toReadings([
      w("new", "2026-09-24T06:00:00.000Z", 73.4),
      w("old", "2026-08-23T06:00:00.000Z", 75.0),
      w("mid", "2026-09-01T06:00:00.000Z", 74.2),
    ]);
    expect(r.map((x) => x.externalId)).toEqual(["old", "mid", "new"]);
  });

  it("handles an empty Health Connect, which is the state today", () => {
    expect(toReadings([], [])).toEqual([]);
    expect(toReadings([])).toEqual([]);
  });
});
