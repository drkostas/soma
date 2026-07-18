import { describe, it, expect, vi, afterEach } from "vitest";
import { logPresetMeal, logDrink, closeDay, toggleCalibration, type Preset } from "./api";

function stubFetch(response: unknown, ok = true) {
  const f = vi.fn().mockResolvedValue({ ok, json: async () => response });
  vi.stubGlobal("fetch", f);
  return f;
}

afterEach(() => vi.unstubAllGlobals());

const preset: Preset = {
  id: "p1", name: "Chicken", meal_slot: "lunch",
  total_calories: 443, total_protein: 49, total_carbs: 48, total_fat: 6, total_fiber: 10,
};

describe("soma universal api payload builders", () => {
  it("logPresetMeal posts the preset payload — including items:[] (regression guard)", async () => {
    const f = stubFetch({ id: 1 });
    const ok = await logPresetMeal("2026-07-16", "lunch", preset);
    expect(ok).toBe(true);
    const [url, opts] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/nutrition/log-meal");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body as string);
    // The log-meal route does JSON.stringify(items); omitting it bound `undefined` → 500.
    expect(body).toMatchObject({
      date: "2026-07-16", meal_slot: "lunch", preset_meal_id: "p1", portion_multiplier: 1, items: [],
    });
    expect(body.preset_macros).toMatchObject({ calories: 443, protein: 49, carbs: 48, fat: 6, fiber: 10 });
  });

  it("logDrink posts drink_type + quantity", async () => {
    const f = stubFetch({ id: 2 });
    await logDrink("2026-07-16", "beer_light", 2);
    const [url, opts] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/nutrition/log-drink");
    expect(JSON.parse(opts.body as string)).toEqual({ date: "2026-07-16", drink_type: "beer_light", quantity: 2 });
  });

  it("closeDay posts the date and returns the status", async () => {
    stubFetch({ status: "closed" });
    expect(await closeDay("2026-07-16")).toBe("closed");
  });

  it("closeDay returns null on a non-ok response", async () => {
    stubFetch({}, false);
    expect(await closeDay("2026-07-16")).toBeNull();
  });

  it("toggleCalibration posts forceEqual", async () => {
    const f = stubFetch({ ok: true, forceEqual: true });
    await toggleCalibration(true);
    const [url, opts] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/training/calibration/toggle");
    expect(JSON.parse(opts.body as string)).toEqual({ forceEqual: true });
  });
});
