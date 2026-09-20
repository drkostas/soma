import { describe, it, expect } from "vitest";
import { slotForHour, captureAck } from "./meal-capture";

describe("slotForHour", () => {
  it("uses the same boundaries as the web and the widgets", () => {
    expect(slotForHour(7)).toBe("breakfast");
    expect(slotForHour(11)).toBe("lunch");
    expect(slotForHour(16)).toBe("dinner");
    expect(slotForHour(21)).toBe("pre_sleep");
  });
  it("never returns the snack slot, which soma does not have", () => {
    for (let h = 0; h < 24; h++) expect(slotForHour(h)).not.toBe("snack");
  });
});

describe("captureAck", () => {
  it("says it is logging when that is what will happen", () => {
    expect(captureAck("log")).toMatch(/logging/i);
  });
  it("says it will be ready to check when it will not log", () => {
    expect(captureAck("calibrate")).toMatch(/check/i);
  });
  it("never claims the meal is already there, because it is not", () => {
    for (const m of ["log", "calibrate"] as const) {
      expect(captureAck(m)).not.toMatch(/\blogged\b|\bdone\b/i);
    }
  });
});
