import { describe, it, expect } from "vitest";
import { partitionWorkouts, syncAllWorkouts, type KnownTimestamps } from "./hevy-ingest";
import type { QueryFn } from "./db";

describe("partitionWorkouts", () => {
  it("saves unseen + changed, skips exact-version matches", () => {
    const known: KnownTimestamps = { a: "t1", b: "t1" };
    const workouts = [
      { id: "a", updated_at: "t1" }, // unchanged → skip
      { id: "b", updated_at: "t2" }, // changed → save
      { id: "c", updated_at: "t1" }, // new → save
    ];
    const { toSave, allKnown } = partitionWorkouts(workouts, known);
    expect(toSave.map((w) => w.wid)).toEqual(["b", "c"]);
    expect(allKnown).toBe(false);
  });

  it("allKnown true when every workout is unchanged", () => {
    const known: KnownTimestamps = { a: "t1", b: "t1" };
    const { toSave, allKnown } = partitionWorkouts(
      [{ id: "a", updated_at: "t1" }, { id: "b", updated_at: "t1" }], known);
    expect(toSave).toEqual([]);
    expect(allKnown).toBe(true);
  });
});

// Mock sql: known-timestamps query returns seeded rows; upserts are recorded.
function mockSql(knownRows: any[], saved: string[]): QueryFn {
  return ((strings: TemplateStringsArray, ...vals: unknown[]) => {
    const text = strings.join(" ");
    if (text.includes("SELECT hevy_id")) return Promise.resolve(knownRows);
    if (text.includes("INSERT INTO hevy_raw_data")) { saved.push(String(vals[0])); return Promise.resolve([]); }
    return Promise.resolve([]);
  }) as unknown as QueryFn;
}

// Mock HevyClient with a fixed set of pages.
function mockClient(pages: any[][], count: number): any {
  return {
    getWorkoutCount: async () => count,
    getWorkouts: async (page: number) => ({ workouts: pages[page - 1] ?? [], page_count: pages.length }),
  };
}

describe("syncAllWorkouts — incremental early-stop", () => {
  it("stops at the first fully-known page (older pages skipped)", async () => {
    // page 1: one new (n1) + one known; page 2: all known → after page 2 stop.
    const pages = [
      [{ id: "n1", updated_at: "t2" }, { id: "k1", updated_at: "t1" }],
      [{ id: "k2", updated_at: "t1" }, { id: "k3", updated_at: "t1" }],
      [{ id: "old", updated_at: "t1" }], // must NOT be scanned
    ];
    const saved: string[] = [];
    const known = [
      { hevy_id: "k1", updated_at: "t1" },
      { hevy_id: "k2", updated_at: "t1" },
      { hevy_id: "k3", updated_at: "t1" },
    ];
    const res = await syncAllWorkouts(mockClient(pages, 5), mockSql(known, saved), { pageSize: 2 });
    expect(saved).toEqual(["n1"]);       // only the new one saved
    expect(res.saved).toBe(1);
    expect(res.pagesScanned).toBe(2);    // stopped after the all-known page 2
    expect(res.skipped).toBe(3);         // k1, k2, k3
  });

  it("scans all pages when everything is new", async () => {
    const pages = [[{ id: "a", updated_at: "t" }], [{ id: "b", updated_at: "t" }]];
    const saved: string[] = [];
    const res = await syncAllWorkouts(mockClient(pages, 2), mockSql([], saved), { pageSize: 1 });
    expect(saved.sort()).toEqual(["a", "b"]);
    expect(res.pagesScanned).toBe(2);
  });
});
