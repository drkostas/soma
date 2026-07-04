"""Tests for kiteboarding jump extraction (kite_jumps).

Ground truth: the watch per-record `heights` stream matches Surfr's cloud
correction exactly (validated on Schinias 2025-11-18: 5.20/4.74/4.23/3.78/3.69).
"""

from datetime import datetime, timedelta

from kite_jumps import (
    assemble_jumps,
    attach_jump_paths,
    group_jumps,
    parse_surfr_description,
)

# Real Surfr description text from the Schinias 2025-11-18 Strava export.
SURFR_DESC = (
    "The Surfr. App - Session at Spot: 'Schinias' \r\n Highest Jump: 5.20 m \r\n "
    "Max. Airtime: 5.43 sec. \r\n Max. Distance: 30 m \r\n Max. Speed: 36 Km/h \r\n\r\n"
    "Top 5 Jumps:\r\n"
    " Nr. 1, H: 5.20 m, A: 5.20 sec., D: 17 m, Max Speed: 21 Km/h, \r\n"
    " Nr. 2, H: 4.74 m, A: 5.43 sec., D: 27 m, Max Speed: 22 Km/h, \r\n"
    " Nr. 3, H: 4.23 m, A: 4.71 sec., D: 30 m, Max Speed: 28 Km/h, \r\n"
    " Nr. 4, H: 3.78 m, A: 3.43 sec., D: 25 m, Max Speed: 22 Km/h, \r\n"
    " Nr. 5, H: 3.69 m, A: 4.22 sec., D: 26 m, Max Speed: 24 Km/h, \r\n"
)


def _sample(t0, secs, h, lat=38.14, lng=24.05, speed=10.0, tup=None, chart=None, ts=None):
    return {
        "time": t0 + timedelta(seconds=secs), "height_m": h, "lat": lat, "lng": lng,
        "speed_ms": speed, "jump_tuple": tup, "jumpchart": chart, "jump_ts": ts,
    }


# --- parse_surfr_description ---

def test_parse_surfr_all_five_jumps():
    jumps = parse_surfr_description(SURFR_DESC)
    assert len(jumps) == 5
    assert [j["height_m"] for j in jumps] == [5.20, 4.74, 4.23, 3.78, 3.69]
    assert jumps[1]["airtime_s"] == 5.43
    assert jumps[2]["distance_m"] == 30


def test_parse_surfr_converts_speed_to_knots():
    jumps = parse_surfr_description(SURFR_DESC)
    # 21 Km/h -> 21 / 1.852 = 11.3 kn
    assert jumps[0]["approach_speed_kn"] == 11.3


def test_parse_surfr_empty():
    assert parse_surfr_description(None) == []
    assert parse_surfr_description("just a normal run, no jumps") == []


# --- group_jumps ---

def test_group_jumps_peak_and_sort():
    t0 = datetime(2025, 11, 18, 11, 0, 0)
    # jump A spans 3 samples peaking at 5.2, jump B (after a >4s gap) peaks 3.0
    samples = [
        _sample(t0, 0, 4.0), _sample(t0, 1, 5.2), _sample(t0, 2, 4.5),
        _sample(t0, 30, 2.8), _sample(t0, 31, 3.0),
    ]
    jumps = group_jumps(samples)
    assert len(jumps) == 2
    assert [j["height_m"] for j in jumps] == [5.2, 3.0]  # sorted biggest-first


def test_group_jumps_splits_on_gap():
    t0 = datetime(2025, 11, 18, 11, 0, 0)
    # three jumps each separated by a >4s gap
    samples = [_sample(t0, 0, 3.0), _sample(t0, 10, 3.5), _sample(t0, 20, 4.0)]
    assert len(group_jumps(samples)) == 3


def test_group_jumps_position_from_peak():
    t0 = datetime(2025, 11, 18, 11, 0, 0)
    samples = [_sample(t0, 0, 2.0, lat=1.0, lng=1.0), _sample(t0, 1, 5.0, lat=2.0, lng=2.0)]
    j = group_jumps(samples)[0]
    assert j["lat"] == 2.0 and j["lng"] == 2.0  # position at the peak sample


def test_group_jumps_native_tuple_and_trajectory():
    """The CIQ `jump` tuple gives real airtime/distance/approach; `jumpchart`
    (cm) becomes a metre trajectory trimmed to one bounding zero per side."""
    t0 = datetime(2025, 11, 18, 11, 0, 0)
    chart = (0, 28, 99, 319, 466, 519, 464, 339, 179, 25, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
    tup = (5.197, 5.2, 17.1, 5.757)
    ts = (1763469942, 1763469941, 1763469947)
    j = group_jumps([_sample(t0, 0, 5.2, tup=tup, chart=chart, ts=ts)])[0]
    assert j["airtime_s"] == 5.2
    assert j["distance_m"] == 17.1
    assert j["approach_speed_kn"] == 11.2  # 5.757 m/s → kn
    assert j["trajectory_m"][0] == 0.0 and j["trajectory_m"][-1] == 0.0
    assert max(j["trajectory_m"]) == 5.19  # 519 cm
    assert len(j["trajectory_m"]) == 11    # 9 in-air points + 2 bounding zeros
    assert j["takeoff_ts"] == 1763469941 and j["landing_ts"] == 1763469947


def test_group_jumps_no_tuple_falls_back():
    """Without the dev fields (old Surfr-synced FITs) there's no airtime and no
    trajectory — just height/position, approach from GPS speed."""
    t0 = datetime(2025, 11, 18, 11, 0, 0)
    j = group_jumps([_sample(t0, 0, 3.0, speed=6.0)])[0]
    assert "airtime_s" not in j and "trajectory_m" not in j
    assert j["approach_speed_kn"] == round(6.0 * 3.6 / 1.852, 1)


# --- assemble_jumps ---

def test_assemble_enriches_top_jumps_by_rank():
    t0 = datetime(2025, 11, 18, 11, 0, 0)
    samples = [_sample(t0, i * 10, h) for i, h in enumerate([5.20, 4.74, 4.23])]
    payload = assemble_jumps(group_jumps(samples), SURFR_DESC)
    assert payload["summary"]["jump_count"] == 3
    assert payload["summary"]["max_height_m"] == 5.20
    assert payload["jumps"][0]["airtime_s"] == 5.20   # from Surfr rank 1
    assert payload["jumps"][1]["distance_m"] == 27     # from Surfr rank 2


def test_assemble_height_guard_blocks_mismatched_enrichment():
    """If the watch height disagrees with Surfr's rank-N height by >0.5m, do not
    attach Surfr's enrichment (protects against a bad session match). A group-span
    airtime estimate is still present, but Surfr's distance/height markers are not."""
    t0 = datetime(2025, 11, 18, 11, 0, 0)
    samples = [_sample(t0, 0, 9.9)]  # nowhere near Surfr's 5.20
    payload = assemble_jumps(group_jumps(samples), SURFR_DESC)
    assert "surfr_height_m" not in payload["jumps"][0]
    assert "distance_m" not in payload["jumps"][0]


def test_attach_jump_paths_slices_flight_window():
    """Path = 1Hz GPS from takeoff-3s to landing+3s, times relative to takeoff."""
    t0 = datetime(2025, 11, 18, 11, 0, 0)
    take, land = 1763469941, 1763469947
    j = group_jumps([_sample(t0, 0, 5.2, tup=(5.2, 5.2, 17.1, 5.8),
                             chart=(0, 100, 519, 100, 0), ts=(take + 1, take, land))])
    track = [(ts, 38.0 + i * 1e-5, 24.0 + i * 1e-5) for i, ts in enumerate(range(take - 10, land + 10))]
    attach_jump_paths(j, track)
    path = j[0]["path"]
    assert path[0][0] == -3 and path[-1][0] == (land - take) + 3
    assert len(path) == (land - take) + 7  # 1Hz inclusive


def test_attach_jump_paths_skips_without_timestamps():
    t0 = datetime(2025, 11, 18, 11, 0, 0)
    j = group_jumps([_sample(t0, 0, 3.0)])  # no dev fields
    attach_jump_paths(j, [(100, 38.0, 24.0), (101, 38.0, 24.0), (102, 38.0, 24.0)])
    assert "path" not in j[0]


def test_assemble_empty_session():
    payload = assemble_jumps([], SURFR_DESC)
    assert payload["summary"]["jump_count"] == 0
    assert payload["summary"]["max_height_m"] is None
    assert payload["jumps"] == []
