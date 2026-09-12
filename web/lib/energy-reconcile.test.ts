import { describe, it, expect } from "vitest";
import { reconcile, KCAL_PER_KG } from "./energy-reconcile";

const day = (date: string, o: Partial<{ observed: boolean; loggedKcal: number; loggedShare: number; burn: number }> = {}) =>
  ({ date, observed: false, loggedKcal: 0, loggedShare: 0, burn: 2400, ...o });

describe("reconcile", () => {
  it("spreads the weight change over unobserved days", () => {
    // 1 kg lost over 4 days = 7700 kcal deficit; day 2 observed at a 700 deficit; 3 unknown days share 7000.
    const out = reconcile(
      [{ date: "2026-09-01", weightKg: 75 }, { date: "2026-09-05", weightKg: 74 }],
      [day("2026-09-01"), day("2026-09-02", { observed: true, loggedKcal: 1700, loggedShare: 1 }), day("2026-09-03"), day("2026-09-04")],
    );
    expect(out.map((d) => d.source)).toEqual(["extrapolated", "observed", "extrapolated", "extrapolated"]);
    expect(out[1].deficit).toBe(-700);
    expect(out[0].deficit).toBeCloseTo(-7000 / 3, 0);
    expect(out.reduce((s, d) => s + d.deficit, 0)).toBeCloseTo(-KCAL_PER_KG, 0);
  });
  it("fills only the missing share of a partial day", () => {
    const out = reconcile(
      [{ date: "2026-09-01", weightKg: 75 }, { date: "2026-09-03", weightKg: 75 }],
      [day("2026-09-01", { loggedKcal: 1200, loggedShare: 0.5 }), day("2026-09-02")],
    );
    // no weight change: 1200 + 0.5A - 2400 + A - 2400 = 0 -> A = 2400
    expect(out[0].source).toBe("partial"); expect(out[0].ate).toBeCloseTo(2400, 0);
    expect(out[1].ate).toBeCloseTo(2400, 0);
  });
  it("borrows the nearest interval after the last weigh-in", () => {
    const out = reconcile(
      [{ date: "2026-09-01", weightKg: 75 }, { date: "2026-09-03", weightKg: 75 }],
      [day("2026-09-01"), day("2026-09-02"), day("2026-09-05")],
    );
    expect(out[2].source).toBe("extrapolated"); expect(out[2].ate).toBeCloseTo(2400, 0); expect(out[2].intervalEnd).toBe("2026-09-03");
  });
  it("leaves unobserved days unknown with fewer than two weigh-ins, observed ones observed", () => {
    const out = reconcile(
      [{ date: "2026-09-01", weightKg: 75 }],
      [day("2026-09-01"), day("2026-09-02", { observed: true, loggedKcal: 2000, loggedShare: 1 })],
    );
    expect(out.map((d) => d.source)).toEqual(["unknown", "observed"]);
    expect(out[1].deficit).toBe(2000 - 2400);
  });
  it("keeps observed days untouched when every day is observed", () => {
    const out = reconcile(
      [{ date: "2026-09-01", weightKg: 75 }, { date: "2026-09-02", weightKg: 75 }],
      [day("2026-09-01", { observed: true, loggedKcal: 2000, loggedShare: 1 })],
    );
    expect(out[0]).toMatchObject({ source: "observed", ate: 2000, deficit: -400 });
  });
});
