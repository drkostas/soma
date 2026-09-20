import { describe, it, expect } from "vitest";
import { emptySlots, hhmm, nextMealSlot, renderContext, type AgentContext } from "./nutrition-agent-context";

const CTX: AgentContext = {
  date: "2026-09-19", slot: "dinner", weightKg: 73.2, now: "19:40",
  slotBudgetKcal: 640, dayRemainingKcal: 900,
  logged: [
    { slot: "breakfast", at: "07:47", calories: 1007, what: "loukoumades, sheep milk yogurt, whole eggs" },
    { slot: "lunch", at: "13:10", calories: 520, what: "chicken breast, rice" },
  ],
  presets: [{ id: "p1", name: "Regular omelette plate", slot: "breakfast", calories: 430, protein: 34, carbs: 12, fat: 26, fiber: 3 }],
  ingredients: [
    { id: "chicken_breast_raw", name: "Chicken Breast (raw)", category: "protein", unit: "g", grams_per_unit: null, small: 104, usual: 150, large: 208, n: 25 },
    { id: "eggs_whole", name: "Eggs (whole)", category: "protein", unit: "egg", grams_per_unit: 50, small: 50, usual: 100, large: 150, n: 12 },
  ],
};

describe("renderContext", () => {
  it("states the day, the slot and what is left", () => {
    const s = renderContext(CTX);
    expect(s).toContain("2026-09-19");
    expect(s).toContain("dinner");
    expect(s).toContain("640");
    expect(s).toContain("73.2");
  });

  it("lists every ingredient with the owner's own small, usual and large", () => {
    const s = renderContext(CTX);
    expect(s).toMatch(/chicken_breast_raw.*104.*150.*208/);
  });

  it("lists the presets by name so a regular meal can be recognised", () => {
    expect(renderContext(CTX)).toContain("Regular omelette plate");
  });

  it("marks a unit-based food with its grams per unit", () => {
    expect(renderContext(CTX)).toMatch(/eggs_whole.*egg.*50/);
  });

  it("says so plainly when there are no presets, rather than leaving a blank", () => {
    expect(renderContext({ ...CTX, presets: [] })).toContain("none saved");
  });

  it("leaves the weight line out when there is no weigh-in", () => {
    expect(renderContext({ ...CTX, weightKg: null })).not.toContain("body weight");
  });
});

describe("emptySlots", () => {
  it("names the slots with nothing in them, in the order of the day", () => {
    expect(emptySlots(CTX.logged)).toEqual(["dinner", "pre_sleep"]);
  });
  it("is the whole day when nothing has been logged", () => {
    expect(emptySlots([])).toEqual(["breakfast", "lunch", "dinner", "pre_sleep"]);
  });
  it("counts a slot once however many meals it holds", () => {
    const twice = [{ slot: "breakfast" }, { slot: "breakfast" }];
    expect(emptySlots(twice)).toEqual(["lunch", "dinner", "pre_sleep"]);
  });
  it("ignores during_workout, which is not a point in the day", () => {
    expect(emptySlots([{ slot: "during_workout" }])).toEqual(["breakfast", "lunch", "dinner", "pre_sleep"]);
  });
});

describe("renderContext puts the day in front of the agent", () => {
  const out = renderContext(CTX);

  it("gives the clock time, because soon-after cannot be judged without it", () => {
    expect(out).toContain("time now: 19:40");
  });

  it("calls the clock's slot a suggestion rather than the answer", () => {
    expect(out).toContain("slot the clock suggests: dinner");
  });

  it("lists what is already logged, with the time and the foods", () => {
    expect(out).toContain("## Already logged today");
    expect(out).toContain("breakfast\t07:47\t1007");
    expect(out).toContain("loukoumades");
  });

  it("says which slots are still empty, so the next meal has an obvious home", () => {
    expect(out).toContain("slots still empty: dinner, pre_sleep");
  });

  it("says so plainly when the day is untouched", () => {
    const out2 = renderContext({ ...CTX, logged: [] });
    expect(out2).toContain("(nothing yet today)");
    expect(out2).toContain("slots still empty: breakfast, lunch, dinner, pre_sleep");
  });

  it("says none rather than an empty list when the day is full", () => {
    const full = ["breakfast", "lunch", "dinner", "pre_sleep"].map((slot) => ({ slot, at: "12:00", calories: 400, what: "x" }));
    expect(renderContext({ ...CTX, logged: full })).toContain("slots still empty: none");
  });
});

describe("hhmm", () => {
  /**
   * Both the logged times and "now" go through this one function, on purpose. The database
   * session here is on America/New_York while the owner and this process are on Europe/Athens, so
   * a time formatted by Postgres would be seven hours out and "soon after breakfast" would be
   * nonsense. One clock, one formatter.
   */
  it("is 24-hour, zero-padded, with no seconds", () => {
    expect(hhmm(new Date(2026, 8, 20, 7, 47))).toBe("07:47");
    expect(hhmm(new Date(2026, 8, 20, 19, 5))).toBe("19:05");
    expect(hhmm(new Date(2026, 8, 20, 0, 0))).toBe("00:00");
  });

  it("formats a logged time and now through the same clock, so they can be compared", () => {
    const logged = new Date(2026, 8, 20, 7, 47);
    const now = new Date(2026, 8, 20, 11, 30);
    // Nothing clever asserted, only that the two are comparable strings from one source.
    expect(hhmm(logged) < hhmm(now)).toBe(true);
  });
});

describe("nextMealSlot", () => {
  /**
   * The rule I got wrong first. "The earliest empty slot" put a plate of chicken and rice at half
   * past three into breakfast, because nothing had been logged and breakfast was the earliest
   * empty one. A skipped slot stays skipped.
   */
  it("is the clock's own slot when that slot is free", () => {
    expect(nextMealSlot([], "lunch")).toBe("lunch");
    expect(nextMealSlot([], "breakfast")).toBe("breakfast");
  });

  it("never reaches backwards into a slot that was skipped", () => {
    expect(nextMealSlot([], "dinner")).toBe("dinner");
    expect(nextMealSlot([{ slot: "lunch" }], "dinner")).toBe("dinner");
  });

  it("moves on when the clock's slot is already taken, which is the next-group rule", () => {
    expect(nextMealSlot([{ slot: "breakfast" }], "breakfast")).toBe("lunch");
    expect(nextMealSlot([{ slot: "breakfast" }, { slot: "lunch" }], "lunch")).toBe("dinner");
  });

  it("skips over several taken slots in a row", () => {
    const logged = [{ slot: "lunch" }, { slot: "dinner" }];
    expect(nextMealSlot(logged, "lunch")).toBe("pre_sleep");
  });

  it("lands on the last slot when everything from here is taken, since the food exists", () => {
    const logged = [{ slot: "dinner" }, { slot: "pre_sleep" }];
    expect(nextMealSlot(logged, "dinner")).toBe("pre_sleep");
  });

  it("treats during_workout as no clue at all and starts from the top", () => {
    expect(nextMealSlot([], "during_workout")).toBe("breakfast");
  });
});

describe("renderContext names where a new meal belongs", () => {
  it("says the slot outright, so the agent is not left computing it", () => {
    // Breakfast and lunch logged, the clock says dinner.
    expect(renderContext(CTX)).toContain("where a NEW meal belongs: dinner");
  });
  it("does not reach back to breakfast late in the day with nothing logged", () => {
    const out = renderContext({ ...CTX, logged: [], slot: "lunch" });
    expect(out).toContain("where a NEW meal belongs: lunch");
  });
});
