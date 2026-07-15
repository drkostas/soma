/**
 * Interleaved partition shuffle — TS port of sync/src/shuffle.py. Spreads
 * same-artist songs evenly (feels more random than Fisher-Yates). RNG-based, so
 * order is non-deterministic; the structural properties (artist spread,
 * first != last-played) are what matter. Used by the live DJ daemon (#187).
 */
export type Song = Record<string, any>;

/** Per-session exclusions + last-played context. Port of SessionState. */
export class SessionState {
  played = new Set<string>();
  skipped = new Set<string>();
  lastPlayedArtistId: string | null = null;

  markPlayed(trackId: string): void { this.played.add(trackId); }
  markSkipped(trackId: string): void { this.skipped.add(trackId); }

  filterCandidates(songs: Song[]): Song[] {
    return songs.filter((s) => !this.played.has(s.track_id) && !this.skipped.has(s.track_id));
  }
  reset(): void { this.played.clear(); this.skipped.clear(); this.lastPlayedArtistId = null; }
}

function artistKey(song: Song): string {
  return song.artist_id || (song.artist_name || "").toLowerCase().replace(/ /g, "_");
}

/**
 * Shuffle so same-artist tracks are evenly spread: partition by artist, shuffle
 * within each, interleave largest-first, then rotate so the first song isn't the
 * last-played artist. Port of interleaved_shuffle.
 */
export function interleavedShuffle(songs: Song[], state?: SessionState | null): Song[] {
  if (!songs.length) return [];

  // 1. Partition by artist.
  const byArtist = new Map<string, Song[]>();
  for (const song of songs) {
    const k = artistKey(song);
    (byArtist.get(k) ?? byArtist.set(k, []).get(k)!).push(song);
  }

  // 2. Shuffle within each partition (Fisher-Yates), then reverse for O(1) pop from tail.
  for (const partition of byArtist.values()) {
    for (let i = partition.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [partition[i], partition[j]] = [partition[j], partition[i]];
    }
    partition.reverse();
  }

  // 3. Interleave: partitions sorted by size desc, round-robin pop.
  let partitions = [...byArtist.values()].sort((a, b) => b.length - a.length);
  const result: Song[] = [];
  while (partitions.length) {
    for (const p of partitions) { const s = p.pop(); if (s !== undefined) result.push(s); }
    partitions = partitions.filter((p) => p.length);
  }

  // 4. Rotate so position 0 isn't the last-played artist (if any other artist exists).
  if (state && state.lastPlayedArtistId && result.length) {
    for (let i = 0; i < result.length; i++) {
      if (artistKey(result[i]) !== state.lastPlayedArtistId) {
        return result.slice(i).concat(result.slice(0, i));
      }
    }
  }
  return result;
}
