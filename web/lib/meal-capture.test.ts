import { describe, it, expect } from "vitest";
import { appendMessage, nextStatus, MAX_ATTEMPTS, type CaptureMessage } from "./meal-capture";

describe("appendMessage", () => {
  it("adds to the thread without losing what is there", () => {
    const thread: CaptureMessage[] = [{ role: "user", text: "omelette", image: null, at: "2026-09-19T18:00:00Z" }];
    const next = appendMessage(thread, { role: "agent", text: "Logged 3 eggs", image: null, at: "2026-09-19T18:01:00Z" });
    expect(next).toHaveLength(2);
    expect(thread).toHaveLength(1); // the original is untouched
    expect(next[1].role).toBe("agent");
  });
});

describe("nextStatus", () => {
  it("walks the happy path", () => {
    expect(nextStatus("captured", "start")).toBe("running");
    expect(nextStatus("running", "resolved_log")).toBe("logged");
    expect(nextStatus("running", "resolved_calibrate")).toBe("ready");
  });

  it("retries before giving up, and gives up at the cap", () => {
    expect(nextStatus("running", "error", 1)).toBe("captured");
    expect(nextStatus("running", "error", MAX_ATTEMPTS)).toBe("failed");
    expect(MAX_ATTEMPTS).toBe(2);
  });

  it("lets a follow-up reopen a finished capture", () => {
    expect(nextStatus("logged", "follow_up")).toBe("captured");
    expect(nextStatus("failed", "follow_up")).toBe("captured");
    expect(nextStatus("ready", "follow_up")).toBe("captured");
  });
});
