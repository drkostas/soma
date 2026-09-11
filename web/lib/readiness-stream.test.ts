import { describe, it, expect } from "vitest";
import { computeDailyReadiness } from "./readiness-stream";
import type { QueryFn } from "./db";


describe("readiness stream — Python parity", () => {
  it("computeDailyReadiness: an 11-day-old 3.7 h night never triggers sleep_under_5h; a night-less target → unknown", async () => {
    // Baseline with proper nights up to 08-23 (3.7 h that night), then RHR-only rows,
    // exactly the shape Garmin produced from 2026-08-24 on.
    const rows: Record<string, unknown>[] = [];
    for (let d = 1; d <= 23; d++) {
      rows.push({ date: `2026-08-${String(d).padStart(2, "0")}`, avg_overnight_hrv: 70, sleep_time_seconds: d === 23 ? 13380 : 25200, resting_heart_rate: 50, body_battery_at_wake: 70 });
    }
    for (let d = 24; d <= 31; d++) rows.push({ date: `2026-08-${d}`, avg_overnight_hrv: null, sleep_time_seconds: null, resting_heart_rate: 50, body_battery_at_wake: null });
    for (let d = 1; d <= 4; d++) rows.push({ date: `2026-09-0${d}`, avg_overnight_hrv: null, sleep_time_seconds: null, resting_heart_rate: 46, body_battery_at_wake: null });
    const writes: unknown[][] = [];
    const sql = (async (strings: TemplateStringsArray, ...vals: unknown[]) => {
      if (strings[0].includes("INSERT INTO daily_readiness")) { writes.push(vals); return []; }
      return rows;
    }) as unknown as QueryFn;
    const out = await computeDailyReadiness(sql, "2026-09-04");
    expect(out.traffic_light).toBe("unknown");
    expect(out.flags).toEqual(["no_sleep_data"]);
    expect(out.composite_score).toBeNull();
    expect(out.rhr_z_score).not.toBeNull(); // the signal that exists is still scored
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("unknown"); // what gets persisted is the unknown light
  });

  it("computeDailyReadiness: no row for the date → unknown / no_target_data, nothing green persisted", async () => {
    const writes: unknown[][] = [];
    const sql = (async (strings: TemplateStringsArray, ...vals: unknown[]) => {
      if (strings[0].includes("INSERT INTO daily_readiness")) { writes.push(vals); return []; }
      return [{ date: "2026-09-01", avg_overnight_hrv: 70, sleep_time_seconds: 25200, resting_heart_rate: 50, body_battery_at_wake: 70 }];
    }) as unknown as QueryFn;
    const out = await computeDailyReadiness(sql, "2026-09-04");
    expect(out.traffic_light).toBe("unknown");
    expect(out.flags).toEqual(["no_target_data"]);
    expect(writes).toHaveLength(0);
  });
});
