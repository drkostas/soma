import { describe, it, expect } from "vitest";
import {
  nutritionDayState,
  nutritionEngagement,
  trainingEngagement,
  WEEK_ENGAGEMENT_FLOOR_DAYS,
  PLAN_COMPLETION_FLOOR,
  PLAN_LIVE_WINDOW_DAYS,
  type NutritionDayInput,
  type PlanDayInput,
} from "./engagement";

const TODAY = "2026-09-06";

function nd(date: string, o: Partial<NutritionDayInput> = {}): NutritionDayInput {
  return { date, status: "closed", coverage: 1, ...o };
}

describe("nutritionDayState", () => {
  const cases: [string, NutritionDayInput, string][] = [
    ["closed at full coverage is complete", nd("2026-09-06"), "complete"],
    ["closed exactly at the floor is complete", nd("2026-09-06", { coverage: 0.75 }), "complete"],
    ["closed below the floor is partial, not complete", nd("2026-09-06", { coverage: 0.5 }), "partial"],
    ["open with something logged is partial", nd("2026-09-06", { status: "active", coverage: 0.25 }), "partial"],
    ["open with nothing logged is absent", nd("2026-09-06", { status: "active", coverage: 0 }), "absent"],
    ["closed with ZERO coverage is absent — the May-Jun poison", nd("2026-09-06", { coverage: 0 }), "absent"],
    ["null coverage is absent, never complete", nd("2026-09-06", { coverage: null }), "absent"],
  ];
  for (const [name, d, want] of cases) it(name, () => expect(nutritionDayState(d)).toBe(want));
});

describe("nutritionEngagement (week ending today)", () => {
  it("floor is 3 of 7, calibrated from Mar-Apr 2026 (#698)", () => {
    expect(WEEK_ENGAGEMENT_FLOOR_DAYS).toBe(3);
  });

  const cases: [string, NutritionDayInput[], string, number][] = [
    ["no rows at all is absent", [], "absent", 0],
    [
      "the user's actual recent state: a few open rows, nothing logged → absent",
      [nd("2026-09-04", { status: "active", coverage: 0 }), nd("2026-09-05", { status: "active", coverage: 0 }), nd("2026-09-06", { status: "active", coverage: 0 })],
      "absent",
      0,
    ],
    [
      "breakfast only on two days is partial",
      [nd("2026-09-05", { status: "active", coverage: 0.25 }), nd("2026-09-06", { status: "active", coverage: 0.25 })],
      "partial",
      0,
    ],
    [
      "two full days is still partial (below the floor)",
      [nd("2026-09-05"), nd("2026-09-06")],
      "partial",
      2 / 7,
    ],
    [
      "three full days is complete",
      [nd("2026-09-04"), nd("2026-09-05"), nd("2026-09-06")],
      "complete",
      3 / 7,
    ],
    [
      "seven full days is complete at coverage 1",
      ["2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06"].map((d) => nd(d)),
      "complete",
      1,
    ],
    [
      "full days OUTSIDE the window do not count (an April streak is not this week)",
      [nd("2026-04-10"), nd("2026-04-11"), nd("2026-04-12"), nd("2026-09-06", { status: "active", coverage: 0 })],
      "absent",
      0,
    ],
    [
      "the poison: closed-with-zero days are absent even inside the window",
      [nd("2026-09-03", { coverage: 0 }), nd("2026-09-04", { coverage: 0 }), nd("2026-09-05", { coverage: 0 }), nd("2026-09-06", { coverage: 0 })],
      "absent",
      0,
    ],
    [
      "a future-dated row is ignored",
      [nd("2026-09-07"), nd("2026-09-06", { status: "active", coverage: 0 })],
      "absent",
      0,
    ],
  ];
  for (const [name, days, wantState, wantCov] of cases) {
    it(name, () => {
      const e = nutritionEngagement(days, TODAY);
      expect(e.state).toBe(wantState);
      expect(e.coverage).toBeCloseTo(wantCov, 6);
      expect(e.basis).toBeTruthy();
    });
  }

  it("basis names the counts", () => {
    const e = nutritionEngagement([nd("2026-09-05"), nd("2026-09-06", { status: "active", coverage: 0.5 })], TODAY);
    expect(e.basis).toContain("1 fully logged");
    expect(e.basis).toContain("1 partly logged");
  });
});

describe("trainingEngagement", () => {
  const knox = { status: "active", planName: "Knoxville HM 2026", raceDate: "2026-04-12" };
  const pd = (day_date: string, o: Partial<PlanDayInput> = {}): PlanDayInput => ({ day_date, run_type: "easy", completed: false, ...o });

  it("floor is 25%, calibrated from Knoxville's best month at 32% (#698)", () => {
    expect(PLAN_COMPLETION_FLOOR).toBe(0.25);
    expect(PLAN_LIVE_WINDOW_DAYS).toBe(7);
  });

  it("no plan is absent", () => {
    const e = trainingEngagement(null, [], TODAY);
    expect(e.state).toBe("absent");
    expect(e.planLive).toBe(false);
  });

  it("an archived plan is absent even with recent days", () => {
    const e = trainingEngagement({ ...knox, status: "archived" }, [pd("2026-09-05", { completed: true })], TODAY);
    expect(e.state).toBe("absent");
    expect(e.planLive).toBe(false);
  });

  it("THE BUG: Knoxville, status active, race five months ago, no days near today → dormant", () => {
    const days = ["2026-03-01", "2026-03-15", "2026-04-01", "2026-04-10"].map((d) => pd(d, { completed: true }));
    const e = trainingEngagement(knox, days, TODAY);
    expect(e.state).toBe("dormant");
    expect(e.planLive).toBe(false);
    expect(e.basis).toContain("Knoxville");
    expect(e.basis).toContain("2026-04-12");
  });

  it("a day exactly at the window edge counts as nearby", () => {
    const e = trainingEngagement(knox, [pd("2026-09-13", { completed: false })], TODAY);
    expect(e.state).not.toBe("dormant");
  });

  it("a day one past the window edge does not", () => {
    const e = trainingEngagement(knox, [pd("2026-09-14")], TODAY);
    expect(e.state).toBe("dormant");
  });

  it("nearby days but none prescribed in the trailing window (brand-new plan) is live and unpenalised", () => {
    const e = trainingEngagement(knox, [pd("2026-09-08"), pd("2026-09-10")], TODAY);
    expect(e.state).toBe("complete");
    expect(e.planLive).toBe(true);
    expect(e.trailingCompletion).toBeNull();
  });

  it("rest days are excluded from the completion denominator", () => {
    const days = [pd("2026-09-01", { run_type: "rest", completed: false }), pd("2026-09-02", { completed: true }), pd("2026-09-08")];
    const e = trainingEngagement(knox, days, TODAY);
    expect(e.trailingCompletion).toBe(1);
    expect(e.state).toBe("complete");
  });

  // Days are generated backwards from today; only those inside the 14-day
  // trailing window count, so `total` is capped there and the expectation is
  // computed from what actually lands in the window.
  const followCases: [string, number, number, string, boolean][] = [
    ["a Knoxville-like rate above the floor (4 of 14 ≈ 29%) is live", 4, 14, "complete", true],
    ["exactly at the floor is live", 1, 4, "complete", true],
    ["just under the floor: plan exists, not followed → partial, not live", 1, 5, "partial", false],
    ["Knoxville April rate 0% → partial, not live", 0, 9, "partial", false],
    ["everything done is live", 7, 7, "complete", true],
    ["days beyond the trailing window are ignored in the rate", 6, 19, "complete", true],
  ];
  for (const [name, done, total, wantState, wantLive] of followCases) {
    it(name, () => {
      const days: PlanDayInput[] = [];
      for (let i = 0; i < total; i++) {
        const d = new Date(Date.UTC(2026, 8, 6 - i)).toISOString().slice(0, 10);
        days.push(pd(d, { completed: i < done }));
      }
      const inWindow = Math.min(total, 14);
      const doneInWindow = Math.min(done, inWindow);
      const e = trainingEngagement(knox, days, TODAY);
      expect(e.state).toBe(wantState);
      expect(e.planLive).toBe(wantLive);
      expect(e.trailingCompletion).toBeCloseTo(doneInWindow / inWindow, 6);
    });
  }
});
