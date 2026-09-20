import { describe, it, expect } from "vitest";
import { anyInFlight, captureDetail, captureHeadline, isSettled, questionOf, saidOf, shortAgo, stripCards, summaryOf, SETTLED_SHOWN, type CaptureCard } from "./capture-status";

const card = (o: Partial<CaptureCard>): CaptureCard => ({
  id: 1, slot: "breakfast", mode: "log", status: "captured", said: "two eggs",
  summary: null, question: null, mealLogId: null, error: null, attempts: 0,
  createdAt: "2026-09-20T07:00:00.000Z", updatedAt: "2026-09-20T07:00:00.000Z", ...o,
});

describe("captureHeadline", () => {
  it("never claims a capture has been read when nothing has read it", () => {
    expect(captureHeadline(card({ status: "captured" }))).toBe("Waiting to be read");
  });
  it("says a retry is a retry, so a silent second wait is not mistaken for the first", () => {
    expect(captureHeadline(card({ status: "captured", attempts: 1 }))).toBe("Waiting to be read again");
  });
  it("distinguishes a question from a proposal, because one needs the owner and the other does not", () => {
    expect(captureHeadline(card({ status: "ready", question: "What did you eat?" }))).toBe("It asked you something");
    expect(captureHeadline(card({ status: "ready", mode: "calibrate" }))).toBe("Ready for you to check");
  });
  it("says logged only when the meal is actually written", () => {
    expect(captureHeadline(card({ status: "logged", mealLogId: 277 }))).toBe("Logged");
  });
  it("owns the failure rather than blaming the sentence", () => {
    expect(captureHeadline(card({ status: "failed" }))).toBe("Could not read it");
  });
});

describe("captureDetail", () => {
  it("puts the question first, since it is the thing being asked of the owner", () => {
    expect(captureDetail(card({ status: "ready", question: "Which bread?", summary: "ignored" }))).toBe("Which bread?");
  });
  it("shows the error on a failure", () => {
    expect(captureDetail(card({ status: "failed", error: "no food in that sentence" }))).toBe("no food in that sentence");
  });
  it("marks a pending retry's error as the previous try, not the verdict", () => {
    expect(captureDetail(card({ status: "captured", attempts: 1, error: "timed out" }))).toBe("Last try: timed out");
  });
  it("has nothing to say about a fresh capture, and says nothing", () => {
    expect(captureDetail(card({ status: "captured" }))).toBeNull();
  });
});

describe("isSettled and anyInFlight", () => {
  it("treats a question as settled for the poller and open for the owner", () => {
    expect(isSettled(card({ status: "ready", question: "Which bread?" }))).toBe(true);
  });
  it("keeps polling only while something is actually moving", () => {
    expect(anyInFlight([card({ status: "logged" }), card({ status: "running" })])).toBe(true);
    expect(anyInFlight([card({ status: "logged" }), card({ status: "failed" })])).toBe(false);
    expect(anyInFlight([])).toBe(false);
  });
});

describe("shortAgo", () => {
  const now = new Date("2026-09-20T08:00:00.000Z").getTime();
  it("says just now for the first stretch, where a precise number would be noise", () => {
    expect(shortAgo("2026-09-20T07:59:30.000Z", now)).toBe("just now");
  });
  it("counts minutes, hours and days", () => {
    expect(shortAgo("2026-09-20T07:50:00.000Z", now)).toBe("10m ago");
    expect(shortAgo("2026-09-20T05:00:00.000Z", now)).toBe("3h ago");
    expect(shortAgo("2026-09-18T08:00:00.000Z", now)).toBe("2d ago");
  });
  it("never counts backwards when a clock disagrees", () => {
    expect(shortAgo("2026-09-20T08:05:00.000Z", now)).toBe("just now");
  });
});

const msg = (role: "user" | "agent", text: string, image: string | null = null) =>
  ({ role, text, image, at: "2026-09-20T07:00:00.000Z" });

describe("saidOf", () => {
  it("is the owner's first line, not the agent's", () => {
    expect(saidOf([msg("user", "two eggs"), msg("agent", "Logged breakfast")])).toBe("two eggs");
  });
  it("names a photo when there were no words at all", () => {
    expect(saidOf([msg("user", "", "/x.jpg")])).toBe("a photo");
  });
  it("is empty rather than undefined for a thread that has none", () => {
    expect(saidOf(null)).toBe("");
    expect(saidOf([])).toBe("");
  });
});

describe("questionOf", () => {
  it("is the question only when nothing was resolved", () => {
    expect(questionOf({ items: [], question: "What did you eat?" })).toBe("What did you eat?");
  });
  it("is null when food was resolved, however the proposal is worded", () => {
    expect(questionOf({ items: [{ query: "eggs" }], question: "Which bread?" })).toBeNull();
  });
  it("survives a proposal that is missing, null or the wrong shape", () => {
    expect(questionOf(null)).toBeNull();
    expect(questionOf(undefined)).toBeNull();
    expect(questionOf("nonsense")).toBeNull();
    expect(questionOf({ items: [] })).toBeNull();
    expect(questionOf({ items: [], question: "   " })).toBeNull();
  });
});

describe("summaryOf", () => {
  it("is the agent's latest word, so a follow-up replaces the earlier one", () => {
    expect(summaryOf([msg("agent", "first"), msg("user", "no, rye"), msg("agent", "second")])).toBe("second");
  });
  it("is null before the agent has said anything", () => {
    expect(summaryOf([msg("user", "two eggs")])).toBeNull();
  });
});

describe("stripCards", () => {
  it("keeps everything that is still moving, however many there are", () => {
    const moving = [card({ id: 1, status: "running" }), card({ id: 2, status: "captured" }), card({ id: 3, status: "running" })];
    expect(stripCards(moving).map((c) => c.id)).toEqual([1, 2, 3]);
  });

  it("keeps only the last few finished ones, so they stop pushing the screen down", () => {
    const done = [1, 2, 3, 4, 5].map((id) => card({ id, status: "logged" }));
    expect(stripCards(done).map((c) => c.id)).toEqual([1, 2]);
    expect(SETTLED_SHOWN).toBe(2);
  });

  it("never drops a question, because it is addressed to the owner", () => {
    const cards = [
      card({ id: 1, status: "logged" }), card({ id: 2, status: "logged" }),
      card({ id: 3, status: "logged" }), card({ id: 4, status: "ready", question: "Which bread?" }),
    ];
    expect(stripCards(cards).map((c) => c.id)).toEqual([1, 2, 4]);
  });

  it("counts the finished ones independently of where they sit in the list", () => {
    const cards = [
      card({ id: 1, status: "logged" }), card({ id: 2, status: "running" }),
      card({ id: 3, status: "failed" }), card({ id: 4, status: "logged" }),
    ];
    expect(stripCards(cards).map((c) => c.id)).toEqual([1, 2, 3]);
  });
});
