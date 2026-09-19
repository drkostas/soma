import { describe, it, expect } from "vitest";
import { captureBody, placeholderFor, ackFor } from "./meal-capture-input";

describe("captureBody", () => {
  it("sends the text and the chosen mode", () => {
    expect(captureBody("200g chicken", null, "calibrate")).toEqual({
      text: "200g chicken", image: null, mode: "calibrate",
    });
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
