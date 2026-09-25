import { describe, it, expect } from "vitest";
import { toReadings, historyWindow, HISTORY_ORIGIN, PAIR_WINDOW_MS, FEEDBACK_ORIGINS, isFeedback, RECENT_WINDOW_DAYS, readWithFallback, readAllPages, MAX_PAGES } from "./health-connect-weight";

describe("historyWindow", () => {
  it("⛔ always starts at the origin, never at a watermark", () => {
    // He asked for the full history. A watermark would permanently miss anything Arboleaf
    // backfills with an old date, which is the case that matters: a month of weigh-ins already
    // exists inside its app and has never left.
    const a = historyWindow(new Date("2026-09-24T18:00:00Z"));
    const b = historyWindow(new Date("2026-12-31T18:00:00Z"));
    expect(a.startTime).toBe(HISTORY_ORIGIN);
    expect(b.startTime).toBe(HISTORY_ORIGIN);
    expect(a.endTime).toBe("2026-09-24T18:00:00.000Z");
  });

  it("reaches back before any scale he has owned", () => {
    // His last body-composition readings came from an Index scale and stopped in April 2022.
    expect(Date.parse(HISTORY_ORIGIN)).toBeLessThan(Date.parse("2021-01-01T00:00:00Z"));
  });
});

describe("toReadings", () => {
  const w = (id: string, time: string, kg: number) => ({ metadata: { id }, time, weight: { inKilograms: kg } });

  it("pairs the body fat written by the same step on the scale", () => {
    const r = toReadings(
      [w("a", "2026-09-24T06:00:00.000Z", 73.4)],
      [{ time: "2026-09-24T06:00:02.000Z", percentage: 18.2 }],
    );
    expect(r).toEqual([{ externalId: "a", origin: null, at: "2026-09-24T06:00:00.000Z", weightKg: 73.4, bodyFatPct: 18.2, source: "HEALTH_CONNECT" }]);
  });

  it("takes the nearest body fat when a day has two weigh-ins", () => {
    const r = toReadings(
      [w("a", "2026-09-24T06:00:00.000Z", 73.4), w("b", "2026-09-24T19:00:00.000Z", 74.1)],
      [
        { time: "2026-09-24T06:00:01.000Z", percentage: 18.2 },
        { time: "2026-09-24T19:00:01.000Z", percentage: 18.9 },
      ],
    );
    expect(r.map((x) => x.bodyFatPct)).toEqual([18.2, 18.9]);
  });

  it("leaves body fat null when nothing was measured near it", () => {
    const r = toReadings(
      [w("a", "2026-09-24T06:00:00.000Z", 73.4)],
      [{ time: "2026-09-24T09:00:00.000Z", percentage: 18.2 }],
    );
    expect(r[0].bodyFatPct).toBeNull();
    expect(PAIR_WINDOW_MS).toBeLessThan(10 * 60 * 1000);
  });

  it("⛔ skips an unusable record rather than sending a zero", () => {
    const r = toReadings([
      { metadata: { id: "a" }, time: "2026-09-24T06:00:00.000Z", weight: {} },
      { metadata: { id: "b" }, time: "not a date", weight: { inKilograms: 73 } },
      { metadata: { id: "c" }, time: "2026-09-24T06:00:00.000Z" },
      w("d", "2026-09-24T07:00:00.000Z", 73.4),
    ]);
    expect(r.map((x) => x.externalId)).toEqual(["d"]);
  });

  it("carries Health Connect's record id, which is what makes re-reading safe", () => {
    expect(toReadings([w("hc-uuid-1", "2026-09-24T06:00:00.000Z", 73.4)])[0].externalId).toBe("hc-uuid-1");
    // A record with no id still goes, and the server's older unique key catches a repeat.
    expect(toReadings([{ time: "2026-09-24T06:00:00.000Z", weight: { inKilograms: 73.4 } }])[0].externalId).toBeNull();
  });

  it("returns the backlog oldest first, so a partial send walks forwards", () => {
    const r = toReadings([
      w("new", "2026-09-24T06:00:00.000Z", 73.4),
      w("old", "2026-08-23T06:00:00.000Z", 75.0),
      w("mid", "2026-09-01T06:00:00.000Z", 74.2),
    ]);
    expect(r.map((x) => x.externalId)).toEqual(["old", "mid", "new"]);
  });

  it("handles an empty Health Connect, which is the state today", () => {
    expect(toReadings([], [])).toEqual([]);
    expect(toReadings([])).toEqual([]);
  });
});

/**
 * ⛔ THE FEEDBACK LOOP. Garmin Connect writes weight INTO Health Connect and reads none of it, so a
 * weigh-in soma pushed to Garmin can return as a new record with a new id and be pushed again. This
 * is the double-count class that already cost this project 13.5% of its 90-day load.
 */
describe("records written by something soma feeds", () => {
  const GARMIN = "com.garmin.android.apps.connectmobile";
  const SCALE = "com.qingniu.arboleaf";

  it("names Garmin Connect, which is the only thing soma pushes weight to", () => {
    expect(FEEDBACK_ORIGINS).toContain(GARMIN);
    expect(isFeedback(GARMIN)).toBe(true);
    expect(isFeedback(SCALE)).toBe(false);
  });

  it("drops Garmin's echo of a weigh-in and keeps the scale's own", () => {
    const out = toReadings([
      { metadata: { id: "scale-1", dataOrigin: SCALE }, time: "2026-09-20T06:00:00.000Z", weight: { inKilograms: 81.3 } },
      { metadata: { id: "garmin-1", dataOrigin: GARMIN }, time: "2026-09-20T06:00:00.000Z", weight: { inKilograms: 81.3 } },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].externalId).toBe("scale-1");
    expect(out[0].origin).toBe(SCALE);
  });

  it("KEEPS a record with no origin, because dropping those would silently sync nothing", () => {
    const out = toReadings([
      { metadata: { id: "no-origin" }, time: "2026-09-20T06:00:00.000Z", weight: { inKilograms: 80 } },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].origin).toBeNull();
  });

  it("drops a Garmin record even when it is the only one there", () => {
    expect(toReadings([
      { metadata: { id: "g", dataOrigin: GARMIN }, time: "2026-09-20T06:00:00.000Z", weight: { inKilograms: 81.3 } },
    ])).toEqual([]);
  });
});

/**
 * ⛔ HEALTH CONNECT REFUSES ANYTHING OLDER THAN 30 DAYS UNLESS READ_HEALTH_DATA_HISTORY IS GRANTED,
 * and the library cannot tell us whether it is (4.1.3 never reports that grant back). So the window
 * is decided by behaviour: ask for everything, and if that is refused, ask for the last 30 days.
 */
describe("the window, when history is not allowed", () => {
  const now = new Date("2026-09-25T12:00:00.000Z");

  it("is the last 30 days", () => {
    expect(RECENT_WINDOW_DAYS).toBe(30);
    expect(historyWindow(now, "recent")).toEqual({
      startTime: "2026-08-26T12:00:00.000Z",
      endTime: "2026-09-25T12:00:00.000Z",
    });
  });

  it("is still the whole history by default, because the backlog is the requirement", () => {
    expect(historyWindow(now).startTime).toBe(HISTORY_ORIGIN);
    expect(historyWindow(now, "full").startTime).toBe(HISTORY_ORIGIN);
  });
});

describe("reading with a fallback to the last 30 days", () => {
  const now = new Date("2026-09-25T12:00:00.000Z");

  it("uses the whole history when Health Connect allows it, and asks only once", async () => {
    const asked: string[] = [];
    const r = await readWithFallback(async (w) => { asked.push(w.startTime); return ["everything"]; }, now);
    expect(r.span).toBe("full");
    expect(r.value).toEqual(["everything"]);
    expect(asked).toEqual([HISTORY_ORIGIN]);
    expect(r.fullError).toBeUndefined();
  });

  it("⛔ falls back to 30 days when the full range is refused, instead of syncing NOTHING", async () => {
    const asked: string[] = [];
    const r = await readWithFallback(async (w) => {
      asked.push(w.startTime);
      if (w.startTime === HISTORY_ORIGIN) throw new Error("Caller doesn't have permission to read data older than 30 days");
      return ["this month"];
    }, now);
    expect(r.span).toBe("recent");
    expect(r.value).toEqual(["this month"]);
    expect(asked).toEqual([HISTORY_ORIGIN, "2026-08-26T12:00:00.000Z"]);
    expect(r.fullError).toContain("older than 30 days");
  });

  it("gives up with the recent error when even 30 days is refused, so the real reason is reported", async () => {
    await expect(readWithFallback(async (w) => {
      throw new Error(w.startTime === HISTORY_ORIGIN ? "full refused" : "no permission at all");
    }, now)).rejects.toThrow("no permission at all");
  });
});

/**
 * ⛔ `readRecords` RETURNS ONE PAGE, 1000 RECORDS BY DEFAULT, AND A `pageToken` WHEN THERE IS MORE.
 * One call silently drops everything past the first page, which for years of daily weigh-ins is the
 * oldest part of the history, the part he asked for.
 */
describe("reading every page", () => {
  it("follows the page token to the end", async () => {
    const pages: Record<string, { records: number[]; pageToken?: string }> = {
      "": { records: [1, 2], pageToken: "p2" },
      p2: { records: [3, 4], pageToken: "p3" },
      p3: { records: [5] },
    };
    const asked: (string | undefined)[] = [];
    const all = await readAllPages(async (t) => { asked.push(t); return pages[t ?? ""]; });
    expect(all).toEqual([1, 2, 3, 4, 5]);
    expect(asked).toEqual([undefined, "p2", "p3"]);
  });

  it("makes one call when everything fits on the first page", async () => {
    let calls = 0;
    const all = await readAllPages(async () => { calls++; return { records: ["a"] }; });
    expect(all).toEqual(["a"]);
    expect(calls).toBe(1);
  });

  it("treats an empty token as the end, not as another page", async () => {
    let calls = 0;
    await readAllPages(async () => { calls++; return { records: [1], pageToken: "" }; });
    expect(calls).toBe(1);
  });

  it("stops at a cap rather than looping for ever on a token that never ends", async () => {
    let calls = 0;
    const all = await readAllPages(async () => { calls++; return { records: [calls], pageToken: "same" }; });
    expect(calls).toBe(MAX_PAGES);
    expect(all).toHaveLength(MAX_PAGES);
  });
});
