# sync/src/shuffle.py
"""Interleaved partition shuffle: spreads same-artist songs evenly.

Feels more random to humans than Fisher-Yates because it prevents
clustering (birthday paradox effect).
"""
import random
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any


Song = dict[str, Any]


@dataclass
class SessionState:
    """Tracks per-session exclusions and last-played context."""
    played: set[str] = field(default_factory=set)
    skipped: set[str] = field(default_factory=set)
    last_played_artist_id: str | None = None

    def mark_played(self, track_id: str) -> None:
        self.played.add(track_id)

    def mark_skipped(self, track_id: str) -> None:
        self.skipped.add(track_id)

    def filter_candidates(self, songs: list[Song]) -> list[Song]:
        excluded = self.played | self.skipped
        return [s for s in songs if s["track_id"] not in excluded]

    def reset(self) -> None:
        self.played.clear()
        self.skipped.clear()
        self.last_played_artist_id = None


def _artist_key(song: Song) -> str:
    """Stable artist identifier, falling back to a slug from artist_name."""
    return song.get("artist_id") or song.get("artist_name", "").lower().replace(" ", "_")


def interleaved_shuffle(
    songs: list[Song],
    state: SessionState | None = None,
) -> list[Song]:
    """Return songs shuffled so same-artist tracks are evenly spread.

    Algorithm:
      1. Partition by artist_id
      2. Shuffle within each partition
      3. Interleave partitions evenly (largest first)
      4. If state provided, rotate so first song != last_played_artist
    """
    if not songs:
        return []

    # Fresh RNG seeded from current time so every call produces a different order
    rng = random.Random(time.time_ns())

    # 1. Partition by artist_id
    by_artist: dict[str, list[Song]] = defaultdict(list)
    for song in songs:
        artist_id = _artist_key(song)
        by_artist[artist_id].append(song)

    # 2. Shuffle within each partition (reverse so pop() from tail is O(1))
    for partition in by_artist.values():
        rng.shuffle(partition)
        partition.reverse()

    # 3. Interleave: sort partitions by size desc, then round-robin
    partitions = sorted(by_artist.values(), key=len, reverse=True)
    result: list[Song] = []
    while partitions:
        for p in partitions:
            if p:
                result.append(p.pop())
        partitions = [p for p in partitions if p]

    # 4. If last-played artist is at position 0, rotate until it isn't.
    # If all songs share last_played_artist, no valid rotation exists — return as-is.
    if state and state.last_played_artist_id and result:
        for i, song in enumerate(result):
            artist_id = _artist_key(song)
            if artist_id != state.last_played_artist_id:
                result = result[i:] + result[:i]
                break

    return result
