import { describe, it, expect } from "vitest";
import { athleteTz, todayAthlete, dateInAthleteTz } from "./athlete-tz";

describe("athlete timezone (#872)", () => {
  it("defaults to Europe/Athens and honours SOMA_TZ", () => {
    expect(athleteTz({})).toBe("Europe/Athens");
    expect(athleteTz({ SOMA_TZ: "America/New_York" })).toBe("America/New_York");
  });
  it("gives the calendar date in that zone", () => {
    const t = new Date("2026-09-11T22:30:00Z"); // 01:30 next day in Athens, 18:30 same day in New York
    expect(dateInAthleteTz(t, "Europe/Athens")).toBe("2026-09-12");
    expect(dateInAthleteTz(t, "America/New_York")).toBe("2026-09-11");
    expect(todayAthlete({ SOMA_TZ: "Europe/Athens" })).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
