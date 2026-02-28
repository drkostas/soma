export interface SongCandidate {
  track_id: string;
  name: string;
  artist_name: string;
  artist_id: string;
  duration_ms: number;
  tempo: number;
  energy: number;
  valence: number;
  quality_score: number;
}

export interface SegmentConfig {
  duration_s: number;
  bpm_min: number;
  bpm_max: number;
  bpm_tolerance: number;
  min_energy: number;
  valence_min: number;
  valence_max: number;
  half_time: boolean;
}

export function bpmQuality(tempo: number, cfg: SegmentConfig): number {
  const center = (cfg.bpm_min + cfg.bpm_max) / 2;
  const half = (cfg.bpm_max - cfg.bpm_min) / 2 + cfg.bpm_tolerance;
  return Math.max(0, 1 - Math.abs(tempo - center) / half);
}

export function halfTimeBpmQuality(tempo: number, cfg: SegmentConfig): number {
  const htCenter = (cfg.bpm_min + cfg.bpm_max) / 4;
  const htHalf = (cfg.bpm_max - cfg.bpm_min) / 4 + cfg.bpm_tolerance / 2;
  return Math.max(0, 1 - Math.abs(tempo - htCenter) / htHalf);
}

export function qualityScore(
  song: { tempo: number; energy: number },
  cfg: SegmentConfig
): number {
  const bpmScore = Math.max(
    bpmQuality(song.tempo, cfg),
    cfg.half_time ? halfTimeBpmQuality(song.tempo, cfg) : 0
  );
  const energyScore = Math.max(0, 1 - Math.abs(song.energy - (cfg.min_energy + 0.1)));
  return 0.6 * bpmScore + 0.4 * energyScore;
}

/** Lexicographic bi-criteria 0/1 Knapsack. Maximizes quality (primary), then fill (secondary). */
export function selectSongsForSegment(
  songs: SongCandidate[],
  capacity: number // seconds
): SongCandidate[] {
  const n = songs.length;
  if (n === 0 || capacity <= 0) return [];

  const GAP = capacity + 1;
  const QSCALE = 1_000_000;

  const dp = new Float64Array(capacity + 1);
  const chosen = new Uint8Array((n + 1) * (capacity + 1));

  for (let i = 0; i < n; i++) {
    const w = Math.floor(songs[i].duration_ms / 1000);
    if (w > capacity) continue;
    const c = Math.round(songs[i].quality_score * QSCALE) * GAP + w;
    for (let j = capacity; j >= w; j--) {
      const candidate = dp[j - w] + c;
      if (candidate > dp[j]) {
        dp[j] = candidate;
        chosen[i * (capacity + 1) + j] = 1;
      }
    }
  }

  // Backtrack
  const selected: SongCandidate[] = [];
  let j = capacity;
  for (let i = n - 1; i >= 0; i--) {
    if (chosen[i * (capacity + 1) + j]) {
      selected.push(songs[i]);
      j -= Math.floor(songs[i].duration_ms / 1000);
    }
  }

  // Sort BPM ascending (natural crescendo)
  selected.sort((a, b) => a.tempo - b.tempo);

  // Post-processing: max 2 consecutive same-artist
  enforceArtistDiversity(selected, songs);

  return selected;
}

function enforceArtistDiversity(
  selected: SongCandidate[],
  allCandidates: SongCandidate[]
) {
  const placedIds = new Set(selected.map((s) => s.track_id));
  for (let i = 2; i < selected.length; i++) {
    if (
      selected[i].artist_id === selected[i - 1].artist_id &&
      selected[i].artist_id === selected[i - 2].artist_id
    ) {
      const alt = allCandidates.find(
        (c) => !placedIds.has(c.track_id) && c.artist_id !== selected[i].artist_id
      );
      if (alt) {
        placedIds.delete(selected[i].track_id);
        selected[i] = alt;
        placedIds.add(alt.track_id);
      }
    }
  }
}

export function pickSkipSong(
  allCandidates: SongCandidate[],
  placedIds: Set<string>
): SongCandidate | null {
  return (
    allCandidates.find((c) => !placedIds.has(c.track_id) && c.duration_ms >= 60_000) ??
    allCandidates.find((c) => !placedIds.has(c.track_id)) ??
    null
  );
}

export function isHalfTimeMatch(tempo: number, cfg: SegmentConfig): boolean {
  return halfTimeBpmQuality(tempo, cfg) > bpmQuality(tempo, cfg) &&
    halfTimeBpmQuality(tempo, cfg) > 0.3;
}
