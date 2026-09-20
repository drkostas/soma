import { describe, it, expect } from "vitest";
import { TONE, toneColor } from "./capture-tone";

/**
 * These are values, not classes, and the component's comment says why. This test exists so a
 * change back to a colour class has to delete a test that explains the trap.
 */
describe("toneColor", () => {
  it("makes a failure red", () => {
    expect(toneColor({ status: "failed" })).toBe(TONE.danger);
  });
  it("lets a logged capture recede, since it needs nothing from the owner", () => {
    expect(toneColor({ status: "logged" })).toBe(TONE.quiet);
  });
  it("keeps everything still in play at full strength", () => {
    for (const status of ["captured", "running", "ready"] as const) {
      expect(toneColor({ status })).toBe(TONE.normal);
    }
  });
  it("is real colour values, because a class does not survive the variant", () => {
    for (const v of Object.values(TONE)) expect(v).toMatch(/^#[0-9a-f]{6}$/);
  });
});
