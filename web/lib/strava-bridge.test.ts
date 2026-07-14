import { describe, it, expect } from "vitest";
import { findMissed, lookbackStart, type GarminActivitySummary } from "./strava-bridge";

const act = (id: number, name = "Run"): GarminActivitySummary => ({ activityId: id, activityName: name });

describe("findMissed — Strava bridge dedup (never-duplicate guard)", () => {
  const activities = [act(100), act(200), act(300)];

  it("excludes activities already in the bridge ledger", () => {
    const missed = findMissed(activities, new Set([200]), "");
    expect(missed.map((a) => a.activityId)).toEqual([100, 300]);
  });

  it("excludes activities whose id appears in the Strava external_ids", () => {
    // 300 already forwarded (its id is among the external_ids) → excluded
    const missed = findMissed(activities, new Set(), "999 300 888");
    expect(missed.map((a) => a.activityId)).toEqual([100, 200]);
  });

  it("both guards together", () => {
    const missed = findMissed(activities, new Set([100]), "300");
    expect(missed.map((a) => a.activityId)).toEqual([200]);
  });

  it("nothing missed when all are bridged or external", () => {
    expect(findMissed(activities, new Set([100, 200]), "300")).toEqual([]);
  });
});

describe("lookbackStart", () => {
  it("returns the date N days before today (UTC)", () => {
    expect(lookbackStart(new Date("2026-07-14T12:00:00Z"), 3)).toBe("2026-07-11");
  });
});
