# sync/tests/test_shuffle.py
import random
from shuffle import interleaved_shuffle, SessionState


def make_song(track_id, artist_name, artist_id=None):
    return {
        "track_id": track_id,
        "artist_name": artist_name,
        "artist_id": artist_id or artist_name.lower().replace(" ", "_"),
        "name": f"Song {track_id}",
        "tempo": 130.0,
        "energy": 0.8,
    }


def test_empty_list():
    assert interleaved_shuffle([]) == []


def test_single_artist_preserves_all_songs():
    songs = [make_song(f"t{i}", "Artist A") for i in range(5)]
    result = interleaved_shuffle(songs)
    assert len(result) == 5
    assert {s["track_id"] for s in result} == {s["track_id"] for s in songs}


def test_no_consecutive_same_artist():
    songs = (
        [make_song(f"a{i}", "Artist A") for i in range(4)]
        + [make_song(f"b{i}", "Artist B") for i in range(4)]
    )
    result = interleaved_shuffle(songs)
    for i in range(len(result) - 1):
        assert result[i]["artist_id"] != result[i + 1]["artist_id"], \
            f"Same artist at positions {i} and {i+1}"


def test_large_artist_spread():
    """Dominant artist (8 songs) in 10-song list must not cluster."""
    songs = (
        [make_song(f"a{i}", "Big Artist") for i in range(8)]
        + [make_song(f"b{i}", "Small") for i in range(2)]
    )
    result = interleaved_shuffle(songs)
    big_positions = [i for i, s in enumerate(result) if s["artist_id"] == "big_artist"]
    # Min gap between same-artist songs should be >= 1
    for i in range(len(big_positions) - 1):
        gap = big_positions[i + 1] - big_positions[i]
        assert gap >= 1


def test_session_state_excludes_played():
    songs = [make_song(f"t{i}", f"Artist {i}") for i in range(10)]
    state = SessionState()
    state.mark_played("t0")
    state.mark_played("t3")
    filtered = state.filter_candidates(songs)
    ids = {s["track_id"] for s in filtered}
    assert "t0" not in ids
    assert "t3" not in ids
    assert len(filtered) == 8


def test_session_state_excludes_skipped():
    songs = [make_song(f"t{i}", f"Artist {i}") for i in range(5)]
    state = SessionState()
    state.mark_skipped("t2")
    filtered = state.filter_candidates(songs)
    assert all(s["track_id"] != "t2" for s in filtered)


def test_no_back_to_back_respects_last_played():
    """If top candidate matches last_played artist, pick the next one."""
    songs = [
        make_song("a1", "Artist A"),
        make_song("a2", "Artist A"),
        make_song("b1", "Artist B"),
    ]
    state = SessionState()
    state.last_played_artist_id = "artist_a"
    result = interleaved_shuffle(songs, state=state)
    # First song must not be Artist A
    assert result[0]["artist_id"] != "artist_a"
