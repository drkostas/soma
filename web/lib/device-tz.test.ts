import { describe, it, expect } from "vitest";
import { readTz, hourInTz, dateInAthleteTz, athleteTz } from "./athlete-tz";

describe("readTz", () => {
  it("takes a real zone from the device", () => {
    expect(readTz("Europe/Athens")).toBe("Europe/Athens");
    expect(readTz("America/New_York")).toBe("America/New_York");
    expect(readTz("Asia/Tokyo")).toBe("Asia/Tokyo");
    expect(readTz("UTC")).toBe("UTC");
  });

  it("falls back rather than throwing, because a bad header must not lose a meal", () => {
    expect(readTz("Mars/Olympus")).toBe(athleteTz());
    expect(readTz("")).toBe(athleteTz());
    expect(readTz(undefined)).toBe(athleteTz());
    expect(readTz(null)).toBe(athleteTz());
    expect(readTz(42)).toBe(athleteTz());
    expect(readTz("x".repeat(200))).toBe(athleteTz());
  });

  it("uses the fallback it is given", () => {
    expect(readTz("nonsense", "Asia/Tokyo")).toBe("Asia/Tokyo");
  });
});

describe("hourInTz", () => {
  // 05:10 UTC, which is 08:10 in Athens, 01:10 in New York and 14:10 in Tokyo.
  const t = new Date("2026-09-22T05:10:00Z");

  it("is the hour where HE is, not where the code runs", () => {
    expect(hourInTz(t, "Europe/Athens")).toBe(8);
    expect(hourInTz(t, "America/New_York")).toBe(1);
    expect(hourInTz(t, "Asia/Tokyo")).toBe(14);
    expect(hourInTz(t, "UTC")).toBe(5);
  });

  it("⛔ reads midnight as hour 0, not 24", () => {
    // en-GB renders midnight as "24" with hour12 false, and slotForHour(24) is not a slot.
    expect(hourInTz(new Date("2026-09-21T21:00:00Z"), "Europe/Athens")).toBe(0);
    expect(hourInTz(new Date("2026-09-21T21:30:00Z"), "Europe/Athens")).toBe(0);
  });

  it("changes the slot near a boundary, which is why this matters", () => {
    // 18:30 UTC is 21:30 in Athens. Dinner where the server is, pre-sleep where he is.
    const evening = new Date("2026-09-22T18:30:00Z");
    expect(hourInTz(evening, "UTC")).toBe(18);
    expect(hourInTz(evening, "Europe/Athens")).toBe(21);
  });
});

describe("the day follows the device too", () => {
  it("is a different calendar day either side of midnight", () => {
    // 22:30 UTC on the 21st is already the 22nd in Athens and still the 21st in New York.
    const t = new Date("2026-09-21T22:30:00Z");
    expect(dateInAthleteTz(t, "Europe/Athens")).toBe("2026-09-22");
    expect(dateInAthleteTz(t, "America/New_York")).toBe("2026-09-21");
    expect(dateInAthleteTz(t, "UTC")).toBe("2026-09-21");
  });
});
