import { describe, it, expect } from "vitest";
import { acceptWeight, MIN_KG, MAX_KG, FEEDBACK_ORIGINS } from "./weight-reading";

const now = new Date("2026-09-24T14:00:00Z");
const ok = (r: Parameters<typeof acceptWeight>[0], tz = "Europe/Athens") => {
  const v = acceptWeight(r, tz, now);
  if (!v.ok) throw new Error(`expected accepted, got: ${v.why}`);
  return v.row;
};

describe("acceptWeight", () => {
  it("takes a real Arboleaf reading and converts to grams", () => {
    const row = ok({ weightKg: 73.4, bodyFatPct: 18.2, at: "2026-09-24T05:12:00Z", externalId: "hc-1" });
    expect(row.weightGrams).toBe(73400);
    expect(row.bodyFatPct).toBe(18.2);
    expect(row.externalId).toBe("hc-1");
    expect(row.sourceType).toBe("HEALTH_CONNECT");
  });

  it("⛔ dates it on HIS clock, not the server's", () => {
    // 22:30 UTC is already the next day in Athens. A weigh-in belongs to the day he stood on it.
    expect(ok({ weightKg: 73.4, at: "2026-09-23T22:30:00Z" }, "Europe/Athens").date).toBe("2026-09-24");
    expect(ok({ weightKg: 73.4, at: "2026-09-23T22:30:00Z" }, "America/New_York").date).toBe("2026-09-23");
  });

  it("refuses a weight that is not a human on a scale", () => {
    for (const kg of [0, -5, 12, 900, NaN]) {
      expect(acceptWeight({ weightKg: kg }, "Europe/Athens", now).ok).toBe(false);
    }
    expect(acceptWeight({ weightKg: MIN_KG }, "Europe/Athens", now).ok).toBe(true);
    expect(acceptWeight({ weightKg: MAX_KG }, "Europe/Athens", now).ok).toBe(true);
  });

  it("refuses a reading with no weight at all, rather than writing a zero", () => {
    expect(acceptWeight({ bodyFatPct: 18 }, "Europe/Athens", now).ok).toBe(false);
    expect(acceptWeight({}, "Europe/Athens", now).ok).toBe(false);
  });

  it("⛔ refuses a future measurement, which the planner would read as a plan", () => {
    expect(acceptWeight({ weightKg: 73.4, at: "2026-09-26T08:00:00Z" }, "Europe/Athens", now).ok).toBe(false);
    // An hour of clock skew is tolerated, because a phone's clock drifts.
    expect(acceptWeight({ weightKg: 73.4, at: "2026-09-24T14:30:00Z" }, "Europe/Athens", now).ok).toBe(true);
  });

  it("drops a nonsense body composition instead of the whole reading", () => {
    const row = ok({ weightKg: 73.4, bodyFatPct: 180, bmi: 0, muscleMassKg: -2 });
    expect(row.weightGrams).toBe(73400);
    expect(row.bodyFatPct).toBeNull();
    expect(row.bmi).toBeNull();
    expect(row.muscleMassGrams).toBeNull();
  });

  it("keeps the body composition Arboleaf actually sends", () => {
    const row = ok({ weightKg: 73.4, bodyFatPct: 18.24, bodyWaterPct: 55.1, muscleMassKg: 58.02, boneMassKg: 3.1, bmi: 22.44 });
    expect(row.bodyFatPct).toBe(18.2);
    expect(row.muscleMassGrams).toBe(58020);
    expect(row.boneMassGrams).toBe(3100);
    expect(row.bmi).toBe(22.4);
  });

  it("has no external id when the source gives none, so the old unique key still applies", () => {
    expect(ok({ weightKg: 73.4 }).externalId).toBeNull();
  });
});

/**
 * ⛔ The second line of defence against the feedback loop. The phone filters Garmin's own records
 * out, and this refuses them again so an older APK cannot open the loop after the server is updated.
 */
describe("a reading that came from something soma feeds", () => {
  const GARMIN = "com.garmin.android.apps.connectmobile";

  it("names Garmin Connect", () => {
    expect(FEEDBACK_ORIGINS).toContain(GARMIN);
  });

  it("is refused, and says why in words worth reading", () => {
    const r = acceptWeight(
      { externalId: "g1", origin: GARMIN, at: "2026-09-20T06:00:00.000Z", weightKg: 81.3 },
      "Europe/Athens",
      new Date("2026-09-21T10:00:00.000Z"),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.why).toContain("our own push returning");
  });

  it("accepts the same reading from the scale", () => {
    const r = acceptWeight(
      { externalId: "s1", origin: "com.qingniu.arboleaf", at: "2026-09-20T06:00:00.000Z", weightKg: 81.3 },
      "Europe/Athens",
      new Date("2026-09-21T10:00:00.000Z"),
    );
    expect(r.ok).toBe(true);
  });

  it("accepts a reading with no origin, so a build that does not send one still works", () => {
    const r = acceptWeight(
      { externalId: "x", at: "2026-09-20T06:00:00.000Z", weightKg: 81.3 },
      "Europe/Athens",
      new Date("2026-09-21T10:00:00.000Z"),
    );
    expect(r.ok).toBe(true);
  });
});
