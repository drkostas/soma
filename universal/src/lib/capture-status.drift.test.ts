/**
 * The app's copy of the status vocabulary must say exactly what the website says.
 *
 * `capture-status.ts` exists twice because the app cannot import from the web package, and a
 * second copy of anything the owner reads is a promise to keep them identical. Neither file has a
 * runtime import, so both can be loaded here and compared answer by answer. A change to one alone
 * fails this, which is the whole point.
 */
import { describe, it, expect } from "vitest";
import * as app from "./capture-status";
import * as web from "../../../web/lib/capture-status";
import type { CaptureCard } from "./capture-status";

const card = (o: Partial<CaptureCard>): CaptureCard => ({
  id: 1, slot: "breakfast", mode: "log", status: "captured", said: "two eggs",
  summary: null, question: null, mealLogId: null, error: null, attempts: 0,
  createdAt: "2026-09-20T07:00:00.000Z", updatedAt: "2026-09-20T07:00:00.000Z", ...o,
});

/** Every shape a capture can be in when a strip renders it. */
const CASES: CaptureCard[] = [
  card({ status: "captured" }),
  card({ status: "captured", attempts: 1, error: "timed out" }),
  card({ status: "running" }),
  card({ status: "ready", question: "What did you eat?" }),
  card({ status: "ready", mode: "calibrate", summary: "Logged breakfast: two eggs" }),
  card({ status: "ready", summary: "Ready" }),
  card({ status: "logged", mealLogId: 277, summary: "Logged breakfast: two eggs" }),
  card({ status: "failed", error: "no food in that sentence could be resolved" }),
];

describe("the app and the web say the same thing", () => {
  it("agrees on every headline", () => {
    for (const c of CASES) {
      expect(app.captureHeadline(c), `headline for ${c.status}/${c.question ? "asked" : c.mode}`)
        .toBe(web.captureHeadline(c));
    }
  });

  it("agrees on every detail line", () => {
    for (const c of CASES) {
      expect(app.captureDetail(c), `detail for ${c.status}`).toBe(web.captureDetail(c));
    }
  });

  it("agrees on what counts as still moving", () => {
    for (const c of CASES) expect(app.isSettled(c)).toBe(web.isSettled(c));
    expect(app.anyInFlight(CASES)).toBe(web.anyInFlight(CASES));
  });

  it("agrees on how long ago something was", () => {
    const now = new Date("2026-09-20T08:00:00.000Z").getTime();
    for (const iso of [
      "2026-09-20T07:59:40.000Z", "2026-09-20T07:45:00.000Z",
      "2026-09-20T02:00:00.000Z", "2026-09-17T08:00:00.000Z", "2026-09-20T08:10:00.000Z",
    ]) {
      expect(app.shortAgo(iso, now), iso).toBe(web.shortAgo(iso, now));
    }
  });

  it("agrees on what it reads out of a thread and a proposal", () => {
    const threads = [
      null,
      [],
      [{ role: "user" as const, text: "two eggs", image: null, at: "x" }],
      [{ role: "user" as const, text: "", image: "/p.jpg", at: "x" },
       { role: "agent" as const, text: "Logged breakfast", image: null, at: "y" }],
    ];
    for (const t of threads) {
      expect(app.saidOf(t)).toBe(web.saidOf(t));
      expect(app.summaryOf(t)).toBe(web.summaryOf(t));
    }
    for (const p of [null, undefined, "nonsense", { items: [] }, { items: [], question: "Which bread?" },
                     { items: [{ query: "eggs" }], question: "Which bread?" }]) {
      expect(app.questionOf(p)).toBe(web.questionOf(p));
    }
  });

  it("exports the same names, so a new function cannot be added to one side only", () => {
    const names = (m: object) => Object.keys(m).filter((k) => typeof (m as Record<string, unknown>)[k] === "function").sort();
    expect(names(app)).toEqual(names(web));
  });
});
