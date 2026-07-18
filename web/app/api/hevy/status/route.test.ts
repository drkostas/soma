import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSql } = vi.hoisted(() => ({ mockSql: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => mockSql }));

import { GET } from "./route";

beforeEach(() => mockSql.mockReset());

describe("GET /api/hevy/status", () => {
  it("maps workout_enrichment rows + counts into the response shape", async () => {
    mockSql
      .mockResolvedValueOnce([
        { hevy_title: "Push", workout_date: "2026-07-13", calories: 282, exercise_count: 3, total_sets: 11, garmin_activity_id: "23590414049", status: "uploaded" },
        { hevy_title: "Lower", workout_date: "2026-07-09", calories: 139, exercise_count: 3, total_sets: 11, garmin_activity_id: null, status: "enriched" },
      ])
      .mockResolvedValueOnce([{ total: 330, synced: 329, week: 2 }]);

    const body = await (await GET()).json();
    expect(body.hevyConnected).toBe(true);
    expect(body.garminConnected).toBe(true);
    expect(body.totalSynced).toBe(329);
    expect(body.syncedThisWeek).toBe(2);
    expect(body.recent).toHaveLength(2);
    expect(body.recent[0]).toMatchObject({ title: "Push", kcal: 282, exercises: 3, sets: 11, synced: true, status: "uploaded" });
    expect(body.recent[1].synced).toBe(false); // null garmin_activity_id → not synced
  });

  it("reports empty/disconnected when there are no workouts", async () => {
    mockSql.mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: 0, synced: 0, week: 0 }]);
    const body = await (await GET()).json();
    expect(body.hevyConnected).toBe(false);
    expect(body.garminConnected).toBe(false);
    expect(body.recent).toEqual([]);
  });
});
