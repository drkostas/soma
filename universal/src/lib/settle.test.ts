import { describe, it, expect } from "vitest";
import { settle, SETTLE_MS } from "./settle";

describe("settle", () => {
  it("hands back a value that is already there", async () => {
    expect(await settle(Promise.resolve("ref"), 50)).toBe("ref");
  });

  it("gives up rather than making him wait for an upload that is stuck", async () => {
    const never = new Promise<string>(() => { /* never resolves */ });
    const started = Date.now();
    expect(await settle(never, 30)).toBeNull();
    expect(Date.now() - started).toBeLessThan(400);
  });

  it("treats a failed upload as nothing, because the words are still in the box", async () => {
    expect(await settle(Promise.reject(new Error("no network")), 50)).toBeNull();
  });

  it("is null when there was never anything in flight", async () => {
    expect(await settle(null, 50)).toBeNull();
  });

  it("waits a beat, not a breath", () => {
    expect(SETTLE_MS).toBeLessThanOrEqual(2000);
  });
});
