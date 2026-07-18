import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockSql } = vi.hoisted(() => ({ mockSql: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => mockSql }));

import { POST } from "./route";

function req(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/nutrition/log-meal", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

// The meal_log INSERT positional values: [0]=strings, [1]=date, [2]=meal_slot,
// [3]=source, [4]=preset_meal_id, [5]=portion, [6]=itemsJson, [7]=calories, [8]=protein…
const mealInsert = () => mockSql.mock.calls.find((c) => String(c[0]).includes("meal_log"));

beforeEach(() => {
  mockSql.mockReset();
  mockSql.mockResolvedValue([{ id: 42 }]);
});

describe("POST /api/nutrition/log-meal", () => {
  it("400s without date or meal_slot", async () => {
    const res = await POST(req({ items: [] }));
    expect(res.status).toBe(400);
  });

  it("computes totals from preset_macros × portion and returns the id", async () => {
    const res = await POST(req({
      date: "2026-07-16", meal_slot: "lunch", preset_meal_id: "p1", portion_multiplier: 2,
      items: [], preset_macros: { calories: 100, protein: 10, carbs: 5, fat: 2, fiber: 1 },
    }));
    expect((await res.json()).id).toBe(42);
    const ins = mealInsert()!;
    expect(ins[7]).toBe(200); // calories 100 × 2
    expect(ins[8]).toBe(20);  // protein 10 × 2
    expect(ins[6]).toBe("[]"); // items serialized (omitting it bound undefined → 500)
  });

  it("sums totals from items when no preset_macros", async () => {
    await POST(req({
      date: "2026-07-16", meal_slot: "lunch",
      items: [
        { name: "x", grams: 100, calories: 50, protein: 5, carbs: 0, fat: 0, fiber: 0 },
        { name: "y", grams: 100, calories: 30, protein: 3, carbs: 0, fat: 0, fiber: 0 },
      ],
    }));
    expect(mealInsert()![7]).toBe(80); // 50 + 30
  });
});
