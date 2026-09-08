import { describe, it, expect } from "vitest";
import { deriveRouteSamples, thinSamples } from "./activity-routes";

// The extractors the heatmap and recent-routes routes used before soma#814, kept here as the
// reference: the cached samples thinned by metric index must reproduce them exactly.
function legacyHeatmap(details: any, thin = 20): Array<[number, number]> {
  const keyIndex: Record<string, number> = {};
  for (const d of details.metricDescriptors) keyIndex[d.key] = d.metricsIndex;
  const latIdx = keyIndex["directLatitude"], lngIdx = keyIndex["directLongitude"];
  const points: Array<[number, number]> = [];
  const metrics = details.activityDetailMetrics;
  for (let i = 0; i < metrics.length; i += thin) {
    const m = metrics[i]?.metrics; if (!m) continue;
    const lat = m[latIdx], lng = m[lngIdx];
    if (lat == null || lng == null || (lat === 0 && lng === 0)) continue;
    points.push([lng, lat]);
  }
  return points;
}
function legacyRecent(details: any, thin = 8) {
  const keyIndex: Record<string, number> = {};
  for (const d of details.metricDescriptors) keyIndex[d.key] = d.metricsIndex;
  const latIdx = keyIndex["directLatitude"], lngIdx = keyIndex["directLongitude"], speedIdx = keyIndex["directSpeed"];
  const points: any[] = [];
  const metrics = details.activityDetailMetrics;
  for (let i = 0; i < metrics.length; i += thin) {
    const m = metrics[i]?.metrics; if (!m) continue;
    const lat = m[latIdx], lng = m[lngIdx];
    if (lat == null || lng == null || (lat === 0 && lng === 0)) continue;
    points.push({ lat, lng, hr: null, speed: speedIdx != null ? (m[speedIdx] ?? null) : null, elev: null, cadence: null, dist_m: null });
  }
  return points;
}

function fixture(n = 500) {
  const metrics: Array<{ metrics: number[] } | undefined> = [];
  for (let i = 0; i < n; i++) {
    if (i % 37 === 0) { metrics.push(undefined as any); continue; }        // rows without metrics
    const lat = i % 11 === 0 ? 0 : 37.97 + i / 1e4;                        // (0,0) fixes are skipped
    const lng = i % 11 === 0 ? 0 : 23.72 + i / 1e4;
    const speed = i % 5 === 0 ? (null as any) : 2.5 + (i % 7) / 10;
    metrics.push({ metrics: [speed, lat, lng, 120] });
  }
  return {
    metricDescriptors: [
      { key: "directSpeed", metricsIndex: 0 },
      { key: "directLatitude", metricsIndex: 1 },
      { key: "directLongitude", metricsIndex: 2 },
      { key: "directHeartRate", metricsIndex: 3 },
    ],
    activityDetailMetrics: metrics,
  };
}

describe("activity route samples (soma#814)", () => {
  it("thinned samples reproduce the heatmap extractor byte for byte", () => {
    const d = fixture();
    const ours = thinSamples(deriveRouteSamples(d), 20).map(([, lat, lng]) => [lng, lat]);
    expect(JSON.stringify(ours)).toBe(JSON.stringify(legacyHeatmap(d, 20)));
    expect(ours.length).toBeGreaterThan(5);
  });
  it("thinned samples reproduce the recent-routes extractor byte for byte", () => {
    const d = fixture();
    const ours = thinSamples(deriveRouteSamples(d), 8).map(([, lat, lng, speed]) => ({ lat, lng, hr: null, speed, elev: null, cadence: null, dist_m: null }));
    expect(JSON.stringify(ours)).toBe(JSON.stringify(legacyRecent(d, 8)));
  });
  it("stores a quarter of the rows and rejects a thin that is not a multiple of it", () => {
    const d = fixture();
    const samples = deriveRouteSamples(d);
    expect(samples.every((s) => s[0] % 4 === 0)).toBe(true);
    expect(() => thinSamples(samples, 6)).toThrow();
  });
  it("returns nothing without descriptors or a fix", () => {
    expect(deriveRouteSamples({})).toEqual([]);
    expect(deriveRouteSamples({ metricDescriptors: [{ key: "directSpeed", metricsIndex: 0 }], activityDetailMetrics: [{ metrics: [1] }] })).toEqual([]);
  });
});
