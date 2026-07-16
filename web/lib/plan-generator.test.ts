import { describe, it, expect } from "vitest";
import { generatePlan } from "./plan-generator";
import golden from "./plan-generator.golden.json";

const g = golden as any;

describe("plan generator — Python parity", () => {
  const plan = generatePlan("2026-04-12"); // defaults: 21.1 km, 5700 s, vdot 47

  it("plan metadata matches", () => {
    expect(plan.plan_name).toBe(g.plan_name);
    expect(plan.race_date).toBe(g.race_date);
    expect(plan.race_distance_km).toBe(g.race_distance_km);
    expect(plan.goal_time_seconds).toBe(g.goal_time_seconds);
    expect(plan.days.length).toBe(g.days.length);
  });

  it("every day matches byte-for-byte (dates, titles, steps, gym, load)", () => {
    for (let i = 0; i < g.days.length; i++) {
      // Deep structural equality against the Python-generated day.
      expect(plan.days[i]).toEqual(g.days[i]);
    }
  });

  it("35 days across 5 weeks, race day last", () => {
    expect(plan.days.length).toBe(35);
    expect(plan.days[34].run_type).toBe("race");
    expect(plan.days[0].day_of_week).toBe(0); // Monday
  });
});
