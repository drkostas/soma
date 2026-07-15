import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { buildKiteJumps, parseSurfrDescription } from "./kite-jumps";
import golden from "./kite-jumps.golden.json";

const here = dirname(fileURLToPath(import.meta.url));
const fitBytes = new Uint8Array(readFileSync(join(here, "__fixtures__", "kite-23561165686.fit")));

describe("kite jump extraction — Python parity", () => {
  it("buildKiteJumps matches Python byte-for-byte on a real Surfr FIT", () => {
    // Real Garmin/Surfr kiteboarding FIT (activity 23561165686, 5 jumps). Exercises
    // the fitsdk decode + developer-field (heights/jump/jumpchart/timestamps)
    // index mapping, jump grouping, trajectory, GPS flight paths, and summary.
    const got = buildKiteJumps(fitBytes, null);
    expect(got).toEqual(golden);
  });

  it("parseSurfrDescription extracts Top-N jumps + converts km/h to knots", () => {
    const desc =
      "Session at Spot: 'Schinias'. Top Jumps: Nr. 1, H: 5.20 m, A: 3.10 sec., D: 40 m, Max Speed: 45 Km/h. " +
      "Nr. 2, H: 4.74 m, A: 2.90 sec., D: 35 m, Max Speed: 42 Km/h. Max Airtime: 3.10 sec";
    const out = parseSurfrDescription(desc);
    expect(out.length).toBe(2);
    expect(out[0]).toEqual({ rank: 1, height_m: 5.2, airtime_s: 3.1, distance_m: 40, approach_speed_kn: 24.3 });
    expect(out[1].rank).toBe(2);
    expect(parseSurfrDescription(null)).toEqual([]);
  });
});
