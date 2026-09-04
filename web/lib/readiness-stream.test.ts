import { describe, it, expect } from "vitest";
import { zScore, computeReadiness, computeDailyReadiness } from "./readiness-stream";
import type { QueryFn } from "./db";
import golden from "./readiness-stream.golden.json";

const g = golden as any;

describe("readiness stream — Python parity", () => {
  it("zScore (population std, 0 on <7 / zero-std)", () => {
    for (const c of g.z_score) expect(zScore(c.in.v, c.in.b)).toBeCloseTo(c.v, 8);
  });

  it("computeReadiness (composite, traffic light, flags, overrides)", () => {
    for (const c of g.readiness) {
      const out = computeReadiness(c.in);
      expect(out.composite_score).toBeCloseTo(c.v.composite_score, 4);
      expect(out.traffic_light).toBe(c.v.traffic_light);
      expect(out.flags).toEqual(c.v.flags);
      expect(out.hrv_z_score).toBe(c.v.hrv_z_score);
      expect(out.rhr_z_score).toBe(c.v.rhr_z_score);
    }
  });
});

// #647 — a missing night is "unknown", never green; stale nights never fire overrides.
describe("readiness — missing last night (#647)", () => {
  it("null sleep_hours → unknown, no_sleep_data, composite null (resting HR alone is not a light)", () => {
    const out = computeReadiness({ hrv_z: null, sleep_z: null, rhr_z: 1.2, bb_z: null, sleep_hours: null, body_battery_morning: null });
    expect(out.traffic_light).toBe("unknown");
    expect(out.flags).toEqual(["no_sleep_data"]);
    expect(out.composite_score).toBeNull();
  });

  it("body battery critical still forces red without a night", () => {
    const out = computeReadiness({ hrv_z: null, sleep_z: null, rhr_z: 0, bb_z: -2, sleep_hours: null, body_battery_morning: 20 });
    expect(out.traffic_light).toBe("red");
    expect(out.flags).toEqual(["no_sleep_data", "body_battery_critical"]);
  });

  it("2-of-4 never downgrades unknown to yellow", () => {
    const out = computeReadiness({ hrv_z: -1.5, sleep_z: null, rhr_z: -1.5, bb_z: null, sleep_hours: null, body_battery_morning: null });
    expect(out.traffic_light).toBe("unknown");
    expect(out.flags).toEqual(["no_sleep_data", "hrv_below_swc"]); // 2_of_4 only ever moves green → yellow
  });

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
