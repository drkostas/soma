import { describe, it, expect } from "vitest";
import { isObservedDay } from "./observed-day";

describe("isObservedDay", () => {
  it("is true for a hand-closed day whatever was logged", () => {
    expect(isObservedDay({ status: "closed", closedBy: "user", coverage: 0.25 })).toBe(true);
  });
  it("is true for a fully logged open day", () => {
    expect(isObservedDay({ status: "active", closedBy: null, coverage: 1 })).toBe(true);
  });
  it("is false for an auto-closed day and for a partial open day", () => {
    expect(isObservedDay({ status: "closed", closedBy: "auto", coverage: 0 })).toBe(false);
    expect(isObservedDay({ status: "active", closedBy: null, coverage: 0.5 })).toBe(false);
    expect(isObservedDay({ status: "closed", closedBy: null, coverage: 0.5 })).toBe(false);
  });
});
