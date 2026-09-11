import { describe, it, expect } from "vitest";
import { isPlannedDate } from "./planned-meal";

describe("isPlannedDate (#873)", () => {
  it("is true only for dates after today", () => {
    expect(isPlannedDate("2026-09-12", "2026-09-11")).toBe(true);
    expect(isPlannedDate("2026-09-11", "2026-09-11")).toBe(false);
    expect(isPlannedDate("2026-09-10", "2026-09-11")).toBe(false);
  });
});
