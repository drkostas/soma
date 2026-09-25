import { describe, it, expect } from "vitest";
import { flagOutliers, localMedian, OUTLIER_KG, LOCAL_WINDOW_DAYS, type WeighIn } from "./weight-plausibility";

/** A real stretch of his log, April to May 2026, hand-entered from the gym scale. */
const REAL: WeighIn[] = [
  { date: "2026-04-28", weightKg: 74.4 },
  { date: "2026-04-29", weightKg: 74.0 },
  { date: "2026-04-30", weightKg: 73.3 },
  { date: "2026-05-01", weightKg: 74.1 },
  { date: "2026-05-04", weightKg: 74.1 },
  { date: "2026-05-05", weightKg: 73.7 },
  { date: "2026-05-12", weightKg: 73.2 },
];

describe("the threshold against his own history", () => {
  it("⛔ discards NONE of his real weigh-ins", () => {
    const { kept, discarded } = flagOutliers(REAL);
    expect(discarded).toEqual([]);
    expect(kept).toHaveLength(REAL.length);
  });

  it("leaves room above the furthest any real weigh-in has sat from its neighbours, 2.15 kg", () => {
    expect(OUTLIER_KG).toBeGreaterThan(2.15);
  });

  it("still discards nothing when the whole run drifts, which is a cut and not a typo", () => {
    // 1 kg a week for six weeks. Every step is small, the total is large.
    const cutting: WeighIn[] = Array.from({ length: 12 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 0, 1 + i * 3)).toISOString().slice(0, 10),
      weightKg: 80 - i * 0.5,
    }));
    expect(flagOutliers(cutting).discarded).toEqual([]);
  });
});

describe("the typos it exists to catch", () => {
  const withBad = (kg: number) =>
    flagOutliers([...REAL.slice(0, 4), { date: "2026-05-02", weightKg: kg }, ...REAL.slice(4)]);

  it("a transposed digit, 73.2 typed as 37.2", () => {
    const { discarded } = withBad(37.2);
    expect(discarded).toHaveLength(1);
    expect(discarded[0].weightKg).toBe(37.2);
    expect(discarded[0].offByKg).toBeGreaterThan(30);
  });

  it("a stray digit, 73.2 typed as 83.2", () => {
    expect(withBad(83.2).discarded.map((d) => d.weightKg)).toEqual([83.2]);
  });

  it("pounds entered as kilograms", () => {
    expect(withBad(161).discarded.map((d) => d.weightKg)).toEqual([161]);
  });

  it("says what it expected instead, so the discard can be checked rather than trusted", () => {
    const { discarded } = withBad(83.2);
    expect(discarded[0].localMedianKg).toBeGreaterThan(73);
    expect(discarded[0].localMedianKg).toBeLessThan(75);
  });

  it("keeps every good weigh-in beside the bad one", () => {
    expect(withBad(161).kept).toHaveLength(REAL.length);
  });
});

describe("the local median", () => {
  it("excludes the weigh-in being judged, so a bad reading cannot excuse itself", () => {
    const rows: WeighIn[] = [
      { date: "2026-05-01", weightKg: 74 },
      { date: "2026-05-02", weightKg: 999 },
      { date: "2026-05-03", weightKg: 74 },
    ];
    expect(localMedian(rows, 1)).toBe(74);
  });

  it("is null when nothing is near, and such a weigh-in is KEPT", () => {
    const lonely: WeighIn[] = [
      { date: "2026-01-01", weightKg: 80 },
      { date: "2026-06-01", weightKg: 73 },
    ];
    expect(localMedian(lonely, 0)).toBeNull();
    expect(flagOutliers(lonely).discarded).toEqual([]);
  });

  it("looks a fortnight either side and no further", () => {
    const rows: WeighIn[] = [
      { date: "2026-05-01", weightKg: 74 },
      { date: "2026-05-16", weightKg: 99 }, // 15 days later, outside the window
    ];
    expect(LOCAL_WINDOW_DAYS).toBe(14);
    expect(localMedian(rows, 0)).toBeNull();
  });

  it("ignores an unreadable date rather than throwing", () => {
    const rows: WeighIn[] = [
      { date: "not a date", weightKg: 74 },
      { date: "2026-05-02", weightKg: 74 },
    ];
    expect(localMedian(rows, 0)).toBeNull();
    expect(() => flagOutliers(rows)).not.toThrow();
  });
});
