import { describe, it, expect } from "vitest";
import { slotBudget, notificationFor, slotsRemaining, ingredientIdFor, agentRunsHere, drainCaptures, processCapture, type LandedMeal } from "./meal-worker";
import type { CaptureRow } from "./meal-capture";

describe("slotBudget", () => {
  it("splits what is left across the slots still to come", () => {
    expect(slotBudget({ dayTarget: 2400, consumed: 800, slotsLeft: 2 })).toBe(800);
  });
  it("never proposes a negative meal", () => {
    expect(slotBudget({ dayTarget: 2000, consumed: 2600, slotsLeft: 1 })).toBe(0);
  });
  it("treats the last slot as taking everything that is left", () => {
    expect(slotBudget({ dayTarget: 2000, consumed: 1500, slotsLeft: 1 })).toBe(500);
  });
  it("falls back to an ordinary meal when there is no plan for the day", () => {
    expect(slotBudget({ dayTarget: 0, consumed: 0, slotsLeft: 3 })).toBe(500);
  });
});

describe("slotsRemaining", () => {
  it("counts this slot and the ones after it", () => {
    expect(slotsRemaining("breakfast")).toBe(4);
    expect(slotsRemaining("dinner")).toBe(2);
    expect(slotsRemaining("pre_sleep")).toBe(1);
  });
  it("treats during_workout as its own thing rather than a point in the day", () => {
    expect(slotsRemaining("during_workout")).toBe(1);
  });
});

describe("ingredientIdFor", () => {
  it("makes a stable slug from a food's name", () => {
    expect(ingredientIdFor("Chicken Burrito Bowl")).toBe("chicken_burrito_bowl");
    expect(ingredientIdFor("  Moe's Stack!  ")).toBe("moe_s_stack");
  });
  it("refuses a name with nothing usable in it", () => {
    expect(ingredientIdFor("!!!")).toBeNull();
    expect(ingredientIdFor("")).toBeNull();
  });
});

describe("notificationFor", () => {
  const landed: LandedMeal = {
    slot: "dinner", summary: "Logged dinner: 250g chicken, 150g rice. 690 kcal.",
    captureId: 12, mealLogId: 34,
  };

  it("tells the owner what it recorded when it logged", () => {
    const n = notificationFor("logged", landed);
    expect(n.title).toContain("Logged");
    expect(n.body).toBe(landed.summary);
    expect(n.url).toContain("12");
  });

  it("asks the owner to look when it is waiting to be calibrated", () => {
    const n = notificationFor("ready", landed);
    expect(n.title).toMatch(/check|ready/i);
    expect(n.url).toContain("12");
  });

  it("says so plainly when it could not work the meal out, and that nothing was lost", () => {
    const n = notificationFor("failed", { ...landed, summary: "" });
    expect(n.title).toMatch(/could not|couldn't/i);
    expect(n.body).toContain("still there");
  });
});

describe("notificationFor, when it has to ask", () => {
  it("puts the question in the notification rather than a summary", () => {
    const n = notificationFor("asked", {
      slot: "dinner", summary: "I can see a plate but cannot tell what is on it. What did you have?",
      captureId: 30, mealLogId: null,
    });
    expect(n.title).toMatch(/question|ask|\?/i);
    expect(n.body).toContain("What did you have");
    expect(n.url).toContain("30");
  });
});

describe("agentRunsHere", () => {
  const saved = process.env.VERCEL;
  const restore = () => { if (saved === undefined) delete process.env.VERCEL; else process.env.VERCEL = saved; };

  it("is true on the Mac, where the agent binary exists", () => {
    delete process.env.VERCEL;
    expect(agentRunsHere()).toBe(true);
    restore();
  });

  it("is false on Vercel, which has no agent to spawn", () => {
    process.env.VERCEL = "1";
    expect(agentRunsHere()).toBe(false);
    restore();
  });
});

describe("drainCaptures where the agent cannot run", () => {
  const saved = process.env.VERCEL;
  const restore = () => { if (saved === undefined) delete process.env.VERCEL; else process.env.VERCEL = saved; };

  it("claims nothing, so a phone capture keeps its attempts for the sweep that can do the work", async () => {
    process.env.VERCEL = "1";
    let queries = 0;
    const sql = (() => { queries++; return Promise.resolve([]); }) as unknown as Parameters<typeof drainCaptures>[0];
    const done = await drainCaptures(sql);
    restore();
    expect(done).toBe(0);
    // The point is not the count. It is that no UPDATE ran, so `attempts` was never spent.
    expect(queries).toBe(0);
  });
});

describe("processCapture when reading the recording fails", () => {
  // The vocabulary query is the first thing readAloud asks for. When it rejects, the capture must
  // go through the same failure path as any other error, or it stays `running` and is never
  // marked failed (#1225).
  function fakeSql() {
    const finished: Array<{ status: unknown; error: unknown }> = [];
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join("?");
      if (text.includes("jsonb_array_elements")) return Promise.reject(new Error("connection reset"));
      if (text.includes("UPDATE meal_capture SET")) finished.push({ status: values[0], error: values[5] });
      return Promise.resolve([]);
    }) as unknown as Parameters<typeof processCapture>[0];
    return { sql, finished };
  }
  const spoken = (attempts: number): CaptureRow => ({
    id: 7, date: "2026-10-26", meal_slot: "lunch", mode: "log", tz: null, status: "running",
    messages: [{ role: "user", text: "two eggs", image: null, at: "2026-10-26T12:00:00Z", audio: "db:1" }],
    proposal: null, resolved: null, meal_log_id: null, error: null, attempts,
  });

  it("puts the capture back for another try on the first attempt", async () => {
    const { sql, finished } = fakeSql();
    await expect(processCapture(sql, spoken(1))).resolves.toBeUndefined();
    expect(finished).toEqual([{ status: "captured", error: "connection reset" }]);
  });

  it("marks the capture failed on the last attempt", async () => {
    const { sql, finished } = fakeSql();
    await expect(processCapture(sql, spoken(2))).resolves.toBeUndefined();
    expect(finished).toEqual([{ status: "failed", error: "connection reset" }]);
  });
});
