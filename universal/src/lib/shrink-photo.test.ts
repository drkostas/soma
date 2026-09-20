import { describe, it, expect } from "vitest";
import { MAX_EDGE, QUALITY, resizeFor } from "./shrink-photo";

describe("resizeFor", () => {
  it("constrains the long side of a landscape photo", () => {
    expect(resizeFor(4032, 3024)).toEqual({ width: MAX_EDGE });
  });
  it("constrains the long side of a portrait photo", () => {
    expect(resizeFor(3024, 4032)).toEqual({ height: MAX_EDGE });
  });
  it("leaves a photo that is already small enough alone", () => {
    expect(resizeFor(1280, 960)).toBeNull();
    expect(resizeFor(800, 600)).toBeNull();
  });
  it("treats a square photo as landscape, which keeps it deterministic", () => {
    expect(resizeFor(2000, 2000)).toEqual({ width: MAX_EDGE });
  });
  it("does nothing with dimensions it cannot believe", () => {
    expect(resizeFor(0, 0)).toBeNull();
    expect(resizeFor(-1, 500)).toBeNull();
    expect(resizeFor(NaN, 500)).toBeNull();
  });
  it("honours a different ceiling when one is given", () => {
    expect(resizeFor(4032, 3024, 640)).toEqual({ width: 640 });
    expect(resizeFor(600, 400, 640)).toBeNull();
  });
  it("keeps the numbers honest, since they decide what the agent sees", () => {
    expect(MAX_EDGE).toBe(1280);
    expect(QUALITY).toBeGreaterThan(0);
    expect(QUALITY).toBeLessThanOrEqual(1);
  });
});
