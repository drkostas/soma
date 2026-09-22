import { describe, it, expect } from "vitest";
import { captureBody, deviceTz, placeholderFor, ackFor } from "./meal-capture-input";

describe("captureBody", () => {
  it("sends the text and the chosen mode", () => {
    expect(captureBody("200g chicken", null, "calibrate", "Europe/Athens")).toEqual({
      text: "200g chicken", image: null, mode: "calibrate", tz: "Europe/Athens",
    });
  });

  it("⛔ carries THIS screen's timezone, because the server's clock is Vercel's", () => {
    // Without it the route guessed the slot and the calendar day from where the code runs: at half
    // past nine here it is half past six there, which is dinner rather than pre-sleep.
    expect(captureBody("a banana", null, "log", "Asia/Tokyo").tz).toBe("Asia/Tokyo");
    // And the real browser value by default, whatever this runner happens to be.
    expect(captureBody("a banana", null, "log").tz).toBe(deviceTz());
  });

  it("carries an attached photo's path", () => {
    expect(captureBody("this plate", "/tmp/soma-meal/a.jpg", "log").image).toBe("/tmp/soma-meal/a.jpg");
  });

  it("trims, because dictation leaves whitespace everywhere", () => {
    expect(captureBody("  chicken and rice  ", null, "log").text).toBe("chicken and rice");
  });
});

describe("placeholderFor", () => {
  it("names the slot it is about to log into", () => {
    expect(placeholderFor("dinner")).toContain("dinner");
  });
  it("reads as an invitation rather than a form label", () => {
    expect(placeholderFor("lunch")).toMatch(/\?/);
  });
});

describe("ackFor", () => {
  it("says it is logging when that is what will happen", () => {
    expect(ackFor("log")).toMatch(/logging/i);
  });
  it("says it will be ready to check when it will not log", () => {
    expect(ackFor("calibrate")).toMatch(/check/i);
  });
  it("never promises the meal is already there, because it is not", () => {
    for (const m of ["log", "calibrate"] as const) {
      expect(ackFor(m)).not.toMatch(/\blogged\b|\bdone\b/i);
    }
  });
});
