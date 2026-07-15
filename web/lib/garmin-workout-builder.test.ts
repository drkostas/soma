import { describe, it, expect } from "vitest";
import { stepsToGarminWorkout } from "./garmin-workout-builder";
import golden from "./garmin-workout-builder.golden.json";

const g = golden as any[];

describe("garmin workout builder — Python parity", () => {
  it("stepsToGarminWorkout matches Python for all 30 plan workouts (incl. repeat groups)", () => {
    for (const c of g) {
      const payload = stepsToGarminWorkout(c.name, c.steps);
      expect(payload).toEqual(c.payload);
    }
  });

  it("produces at least one RepeatGroupDTO across the plan", () => {
    const hasRepeat = g.some((c) => {
      const payload = stepsToGarminWorkout(c.name, c.steps) as any;
      return payload.workoutSegments[0].workoutSteps.some((s: any) => s.type === "RepeatGroupDTO");
    });
    expect(hasRepeat).toBe(true);
  });
});
