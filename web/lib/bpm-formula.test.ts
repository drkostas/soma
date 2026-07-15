import { describe, it, expect } from "vitest";
import { hrrToBpm, latestHrFromGarminData } from "./bpm-formula";
import { interleavedShuffle, SessionState } from "./dj-shuffle";
import golden from "./bpm-formula.golden.json";

const g = golden as Array<{ hr: number; hr_rest: number; hr_max: number; offset: number; bpm: number }>;

describe("bpm formula — Python parity", () => {
  it("hrrToBpm matches Python across HR sweeps + rest/max/offset combos", () => {
    for (const c of g) expect(hrrToBpm(c.hr, c.hr_rest, c.hr_max, c.offset)).toBe(c.bpm);
  });

  it("latestHrFromGarminData returns the most recent in-window reading", () => {
    const now = 1_000_000_000_000;
    const data = { heartRateValues: [
      [now - 300_000, 120], [now - 60_000, 150], [now - 10_000, null], [now - 5_000, 155],
    ] as Array<[number, number | null]> };
    expect(latestHrFromGarminData(data, 120, now)).toEqual([155, (now - 5_000) / 1000]);
    // all stale -> null
    expect(latestHrFromGarminData({ heartRateValues: [[now - 300_000, 120]] }, 120, now)).toBeNull();
    expect(latestHrFromGarminData({ heartRateValues: [] }, 120, now)).toBeNull();
  });
});

describe("dj shuffle — structural properties", () => {
  const songs = Array.from({ length: 20 }, (_, i) => ({
    track_id: `t${i}`, artist_id: `a${i % 4}`, artist_name: `Artist ${i % 4}`,
  }));

  it("keeps every song exactly once", () => {
    const out = interleavedShuffle(songs);
    expect(out.length).toBe(songs.length);
    expect(new Set(out.map((s) => s.track_id)).size).toBe(songs.length);
  });

  it("spreads same-artist tracks (no long adjacent runs)", () => {
    // With 4 artists × 5 tracks interleaved, adjacent same-artist should be rare.
    let adjacentSame = 0;
    const out = interleavedShuffle(songs);
    for (let i = 1; i < out.length; i++) if (out[i].artist_id === out[i - 1].artist_id) adjacentSame++;
    expect(adjacentSame).toBeLessThanOrEqual(1);
  });

  it("rotates so position 0 isn't the last-played artist", () => {
    const state = new SessionState();
    state.lastPlayedArtistId = "a0";
    for (let n = 0; n < 20; n++) {
      const out = interleavedShuffle(songs, state);
      expect(out[0].artist_id).not.toBe("a0");
    }
  });

  it("SessionState filters played + skipped", () => {
    const state = new SessionState();
    state.markPlayed("t0"); state.markSkipped("t1");
    const filtered = state.filterCandidates(songs);
    expect(filtered.find((s) => s.track_id === "t0")).toBeUndefined();
    expect(filtered.find((s) => s.track_id === "t1")).toBeUndefined();
    expect(filtered.length).toBe(18);
  });
});
