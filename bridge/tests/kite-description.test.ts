import { describe, it, expect } from "vitest";
import { kiteActivityName, generateKiteStravaDescription } from "../src/kite-description";
import golden from "./kite-description.golden.json";

describe("kite description — Python parity", () => {
  it("kiteActivityName + generateKiteStravaDescription match Python", () => {
    for (const c of golden as any[]) {
      expect(kiteActivityName(c.summary, c.payload)).toBe(c.name);
      expect(generateKiteStravaDescription(c.summary, c.payload)).toBe(c.desc);
    }
  });
});
