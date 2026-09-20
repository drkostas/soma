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

/** The values bound to the INSERT that writes the meal. */
function insertValues(): unknown[] {
  const call = mockSql.mock.calls.find((c) => String((c[0] as string[]).join("")).includes("INSERT INTO meal_log"));
  if (!call) throw new Error("no meal_log insert was made");
  return call.slice(1);
}

beforeEach(() => {
  mockSql.mockReset();
  mockSql.mockResolvedValue([{ id: 7 }]);
});

describe("POST /api/nutrition/log-meal", () => {
  it("persists source, notes and weigh_method instead of discarding them", async () => {
    await POST(req({
      date: "2026-09-19", meal_slot: "lunch", source: "chat",
      notes: "big plate of omelette, 5 eggs 3 only whites",
      weigh_method: "counted",
      items: [{ ingredient_id: "eggs_whole", grams: 100, calories: 143, protein: 13, carbs: 1, fat: 10, fiber: 0 }],
    }));
    const v = insertValues();
    expect(v).toContain("chat");
    expect(v).toContain("big plate of omelette, 5 eggs 3 only whites");
    expect(v).toContain("counted");
  });

  it("still calls a preset log a preset, whatever the caller said", async () => {
    await POST(req({
      date: "2026-09-19", meal_slot: "lunch", preset_meal_id: "abc", source: "chat", items: [],
      preset_macros: { calories: 400, protein: 30, carbs: 40, fat: 10, fiber: 5 },
    }));
    expect(insertValues()).toContain("preset");
  });

  it("leaves the three columns null when the caller says nothing", async () => {
    await POST(req({
      date: "2026-09-19", meal_slot: "lunch",
      items: [{ ingredient_id: "eggs_whole", grams: 50, calories: 72 }],
    }));
    const v = insertValues();
    expect(v).toContain(null);
  });

  it("400s without a date or a slot", async () => {
    expect((await POST(req({ meal_slot: "lunch", items: [] }))).status).toBe(400);
    expect((await POST(req({ date: "2026-09-19", items: [] }))).status).toBe(400);
  });
});
