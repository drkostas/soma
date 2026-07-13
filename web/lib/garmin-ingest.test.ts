import { describe, it, expect } from "vitest";
import { toPath, todayNyc, getStaleDates } from "./garmin-ingest";
import { buildRequest, DAILY_ENDPOINTS } from "./garmin-endpoints";
import type { QueryFn } from "./db";

describe("toPath — connectapi query serialization", () => {
  it("appends params as a query string, no params → bare url", () => {
    expect(toPath({ url: "/x/y", params: null })).toBe("/x/y");
    expect(toPath(buildRequest(DAILY_ENDPOINTS.heart_rates, { display: "U", cdate: "2026-07-13" })))
      .toBe("/wellness-service/wellness/dailyHeartRate/U?date=2026-07-13");
    expect(toPath(buildRequest(DAILY_ENDPOINTS.sleep_data, { display: "U", cdate: "2026-07-13" })))
      .toBe("/wellness-service/wellness/dailySleepData/U?date=2026-07-13&nonSleepBufferMinutes=60");
  });
});

describe("todayNyc", () => {
  it("returns YYYY-MM-DD in America/New_York", () => {
    // 2026-07-13 03:30 UTC is still 2026-07-12 in New York (EDT, -4).
    expect(todayNyc(new Date("2026-07-13T03:30:00Z"))).toBe("2026-07-12");
    expect(todayNyc(new Date("2026-07-13T12:00:00Z"))).toBe("2026-07-13");
  });
});

// Minimal mock QueryFn: routes by the SQL text of the first template chunk.
function mockSql(hrRows: any[], partialRows: any[]): QueryFn {
  return ((strings: TemplateStringsArray) => {
    const sql = strings.join(" ");
    if (sql.includes("heartRateValues")) return Promise.resolve(hrRows);
    if (sql.includes("daily_health_summary")) return Promise.resolve(partialRows);
    return Promise.resolve([]);
  }) as unknown as QueryFn;
}

describe("getStaleDates", () => {
  const now = new Date("2026-07-13T12:00:00Z"); // NY: 2026-07-13

  it("always includes today", async () => {
    const dates = await getStaleDates(mockSql([], []), 14, now);
    expect(dates).toContain("2026-07-13");
  });

  it("with a recent complete HR day, re-syncs days AFTER it (not the complete day itself)", async () => {
    // complete day 2026-07-11, today 07-13 → days_back=2 → adds 07-13, 07-12 (Python range(2)).
    // The complete day 07-11 is NOT re-synced.
    const dates = await getStaleDates(mockSql([{ date: "2026-07-11", pts: 700 }], []), 14, now);
    expect(dates).toEqual(expect.arrayContaining(["2026-07-12", "2026-07-13"]));
    expect(dates).not.toContain("2026-07-11");
    expect(dates).not.toContain("2026-07-01");
  });

  it("with no complete HR day, includes the whole lookback window", async () => {
    const dates = await getStaleDates(mockSql([{ date: "2026-07-12", pts: 100 }], []), 14, now);
    expect(dates.length).toBeGreaterThanOrEqual(14);
  });

  it("folds in partial-health-summary dates", async () => {
    const dates = await getStaleDates(mockSql([{ date: "2026-07-12", pts: 700 }], [{ date: "2026-07-09" }]), 14, now);
    expect(dates).toContain("2026-07-09");
  });

  it("returns dates sorted descending", async () => {
    const dates = await getStaleDates(mockSql([{ date: "2026-07-11", pts: 700 }], []), 14, now);
    const sorted = [...dates].sort().reverse();
    expect(dates).toEqual(sorted);
  });
});
