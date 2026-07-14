import { describe, it, expect } from "vitest";
import { selectToEnrich, type HevyWorkoutRow, type ExistingEnrichment } from "./hevy-enrich-run";

const wk = (id: string, date: string): HevyWorkoutRow => ({ hevyId: id, hevyTitle: id, workout: {}, date });

describe("selectToEnrich — new + stale selection (enrich_new_workouts parity)", () => {
  const staleCutoff = "2026-07-07"; // 7 days before "now"
  const workouts: HevyWorkoutRow[] = [
    wk("new1", "2026-07-13"),   // no enrichment → new
    wk("daily1", "2026-07-12"), // enriched with daily HR → not stale
    wk("fallback1", "2026-07-11"), // enriched with avg HR, recent → stale (retry)
    wk("fallbackOld", "2026-06-01"), // avg HR but too old → not stale
  ];
  const existing = new Map<string, ExistingEnrichment>([
    ["daily1", { hrSource: "daily", garminActivityId: 1 }],
    ["fallback1", { hrSource: "avg_5", garminActivityId: null }],
    ["fallbackOld", { hrSource: "static", garminActivityId: null }],
  ]);

  it("picks new workouts and recent non-daily ones, skips daily + old", () => {
    const { newWorkouts, staleWorkouts } = selectToEnrich(workouts, existing, staleCutoff);
    expect(newWorkouts.map((w) => w.hevyId)).toEqual(["new1"]);
    expect(staleWorkouts.map((w) => w.hevyId)).toEqual(["fallback1"]);
  });

  it("empty when nothing needs enrichment", () => {
    const allDaily = new Map<string, ExistingEnrichment>([["a", { hrSource: "daily", garminActivityId: 1 }]]);
    const r = selectToEnrich([wk("a", "2026-07-13")], allDaily, staleCutoff);
    expect(r.newWorkouts).toEqual([]);
    expect(r.staleWorkouts).toEqual([]);
  });
});
