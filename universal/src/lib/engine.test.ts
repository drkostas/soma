import { describe, it, expect } from "vitest";
import { readinessFactorCalc, fatigueFactorCalc, DEFAULT_BASE_PACE } from "./training-engine";
import { getHMPrediction, getBasePace, getHRZone } from "./vdot-pace-zones";
import { vdotFromHmSeconds } from "./vdot-utils";
import { projectVdotSeries, projectVdotAt, DEFAULT_BANISTER, type DailyLoad } from "./banister-projection";
import { ALL_MUSCLE_GROUPS, MUSCLE_COLORS, MUSCLE_TO_SLUGS, SLUG_TO_MUSCLE, hexToRgba } from "./muscle-groups";

/**
 * Golden tests for the pure logic ported into the mobile app. These modules
 * were copied to match the web/Python engine; the assertions pin the exact
 * transfer-function values (and mapping invariants) so a future edit can't
 * silently drift the trajectory, what-if, pace or body-map features.
 */

describe("training-engine transfer functions (golden)", () => {
  it("readinessFactorCalc: anchors, interpolation, REST", () => {
    expect(readinessFactorCalc(0)).toBeCloseTo(1.0, 6);
    expect(readinessFactorCalc(1)).toBeCloseTo(0.97, 6);
    expect(readinessFactorCalc(2)).toBeCloseTo(0.97, 6); // clamp high
    expect(readinessFactorCalc(0.5)).toBeCloseTo(0.985, 6); // 1 - 0.03*0.5
    expect(readinessFactorCalc(-0.5)).toBeCloseTo(1.025, 6); // 1 - 0.05*(-0.5)
    expect(readinessFactorCalc(-1)).toBeCloseTo(1.05, 6);
    expect(readinessFactorCalc(-1.5)).toBeCloseTo(1.05, 6);
    expect(readinessFactorCalc(-2)).toBe(-1.0); // REST signal
    expect(readinessFactorCalc(-3)).toBe(-1.0);
  });

  it("fatigueFactorCalc: anchors + interpolation", () => {
    expect(fatigueFactorCalc(0)).toBeCloseTo(1.0, 6);
    expect(fatigueFactorCalc(10)).toBeCloseTo(0.98, 6);
    expect(fatigueFactorCalc(20)).toBeCloseTo(0.98, 6); // clamp high
    expect(fatigueFactorCalc(5)).toBeCloseTo(0.99, 6); // 1 - 0.002*5
    expect(fatigueFactorCalc(-10)).toBeCloseTo(1.015, 6); // 1 - 0.0015*(-10)
    expect(fatigueFactorCalc(-20)).toBeCloseTo(1.03, 6);
    expect(fatigueFactorCalc(-30)).toBeCloseTo(1.03, 6); // clamp low
  });

  it("DEFAULT_BASE_PACE is 284 sec/km", () => {
    expect(DEFAULT_BASE_PACE).toBe(284.0);
  });
});

describe("VDOT pace + HM prediction (golden)", () => {
  it("getHMPrediction matches the table and interpolates", () => {
    expect(getHMPrediction(47)).toBe(5798);
    expect(getHMPrediction(48)).toBe(5693);
    expect(getHMPrediction(47.9)).toBe(5704); // 1:35:04 (matches the in-app trajectory)
  });

  it("getBasePace reads the easy zone and is case-insensitive with a fallback", () => {
    expect(getBasePace(40, "easy")).toBe(379);
    expect(getBasePace(40, "EASY")).toBe(379);
    expect(getBasePace(40, "not-a-real-type")).toBe(379); // falls back to easy
  });

  it("vdotFromHmSeconds round-trips with getHMPrediction (within ~0.5 VDOT)", () => {
    // The two are independent implementations (table interpolation vs formula),
    // so a sub-point round-trip drift is expected; guard it stays small.
    for (const v of [40, 45, 47.9, 50, 55]) {
      expect(Math.abs(vdotFromHmSeconds(getHMPrediction(v)) - v)).toBeLessThan(0.5);
    }
  });

  it("getHRZone falls back to easy for unknown types", () => {
    expect(getHRZone("not-a-real-type")).toEqual(getHRZone("easy"));
    expect(getHRZone("tempo")).toBeDefined();
  });
});

describe("banister projection (properties)", () => {
  // Valid sequential ISO dates across month boundaries (naive DD padding overflows).
  const days = (n: number, load: number): DailyLoad[] =>
    Array.from({ length: n }, (_, i) => ({
      date: new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10),
      load,
    }));

  it("returns one finite value per load day", () => {
    const s = projectVdotSeries(days(30, 5), DEFAULT_BANISTER);
    expect(s).toHaveLength(30);
    expect(s.every(Number.isFinite)).toBe(true);
  });

  it("zero training holds VDOT at the baseline p0", () => {
    const s = projectVdotSeries(days(30, 0), DEFAULT_BANISTER);
    expect(s[0]).toBeCloseTo(DEFAULT_BANISTER.p0, 6);
    expect(s[s.length - 1]).toBeCloseTo(DEFAULT_BANISTER.p0, 6);
  });

  it("sustained training moves VDOT off the baseline", () => {
    const s = projectVdotSeries(days(60, 10), DEFAULT_BANISTER);
    expect(Math.abs(s[s.length - 1] - DEFAULT_BANISTER.p0)).toBeGreaterThan(0.1);
  });

  it("projectVdotAt agrees with the series at the final date", () => {
    const loads = days(20, 8);
    const s = projectVdotSeries(loads, DEFAULT_BANISTER);
    const at = projectVdotAt(loads, DEFAULT_BANISTER, loads[loads.length - 1].date);
    expect(at).toBeCloseTo(s[s.length - 1], 4);
  });
});

describe("muscle-group mapping (invariants)", () => {
  it("has the 11 canonical groups", () => {
    expect(ALL_MUSCLE_GROUPS).toHaveLength(11);
  });

  it("every slug maps back to the group that declared it", () => {
    for (const [mg, slugs] of Object.entries(MUSCLE_TO_SLUGS)) {
      for (const slug of slugs) {
        expect(SLUG_TO_MUSCLE[slug]).toBe(mg);
      }
    }
  });

  it("pins the non-obvious group to slug mappings", () => {
    expect(MUSCLE_TO_SLUGS.shoulders).toContain("deltoids");
    expect(MUSCLE_TO_SLUGS.back).toEqual(expect.arrayContaining(["upper-back", "lower-back", "trapezius"]));
    expect(MUSCLE_TO_SLUGS.core).toEqual(expect.arrayContaining(["abs", "obliques"]));
  });

  it("every group has a hex colour", () => {
    for (const mg of ALL_MUSCLE_GROUPS) {
      expect(MUSCLE_COLORS[mg]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("hexToRgba formats and clamps alpha", () => {
    expect(hexToRgba("#ef4444", 0.5)).toBe("rgba(239, 68, 68, 0.50)");
    expect(hexToRgba("#ffffff", 2)).toBe("rgba(255, 255, 255, 1.00)"); // clamp high
    expect(hexToRgba("#000000", -1)).toBe("rgba(0, 0, 0, 0.00)"); // clamp low
  });
});
