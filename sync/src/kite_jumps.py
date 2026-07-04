"""Extract kiteboarding jump data from Garmin/Surfr FIT files.

The watch runs Surfr's Connect IQ data field, which writes per-jump height into
the FIT `record` stream (developer field `heights`) together with GPS position
and timestamp. We validated that this per-record height matches Surfr's
cloud-corrected value exactly (e.g. 5.20/4.74/4.23/3.78/3.69 m on Schinias
2025-11-18). The session-level summary `maxheight` field is unreliable (it can
glitch to e.g. 13.51 m) and is intentionally ignored.

Surfr's auto-exported Strava activity (stored in `strava_raw_data`) carries the
corrected Top-5 description with per-jump airtime / distance / approach-speed.
We join that in by rank to enrich the biggest jumps.

Heights stay in meters (the kiteboarding convention for jump height). Speeds are
exposed in knots per the project preference.
"""

import re

import fitparse

KMH_TO_KNOTS = 1 / 1.852
MS_TO_KNOTS = 3.6 / 1.852

# A record's `heights` field is non-zero only during a jump; the same height
# repeats across the airtime samples. Runs separated by more than this many
# seconds are treated as separate jumps.
_JUMP_GAP_S = 4
_MIN_JUMP_M = 0.3
# Surfr only corrects heights it agrees with within this tolerance; used to
# guard the rank-based join so a mismatched session can't attach wrong airtimes.
_SURFR_MATCH_TOL_M = 0.5

_SURFR_JUMP_RE = re.compile(
    r"Nr\.\s*(\d+)\s*,\s*H:\s*([\d.]+)\s*m\s*,\s*A:\s*([\d.]+)\s*sec\.?\s*,\s*"
    r"D:\s*(\d+)\s*m\s*,\s*Max\s*Speed:\s*(\d+)\s*Km/h",
    re.IGNORECASE,
)
_SURFR_SPOT_RE = re.compile(r"Spot:\s*'([^']+)'", re.IGNORECASE)
_SURFR_MAXAIR_RE = re.compile(r"Max\.?\s*Airtime:\s*([\d.]+)\s*sec", re.IGNORECASE)


def _semicircles_to_deg(v):
    return v * (180 / 2**31) if v is not None else None


def _read_jump_samples(fit_path: str) -> list[dict]:
    """Read the per-record jump samples (heights>0) from a FIT file.

    Besides the `heights` value, each record carries three richer developer
    fields written by Surfr's Connect IQ app (validated against Surfr's
    cloud-corrected output — exact match):
      - `jump`:      (height_m, airtime_s, distance_m, approach_speed_ms)
      - `jumpchart`: uint32[20] — the measured height trajectory in cm
      - `timestamps`: (detect_ts, takeoff_ts, landing_ts) unix seconds
    """
    fit = fitparse.FitFile(fit_path)
    samples = []
    for msg in fit.get_messages("record"):
        d = {x.name: x.value for x in msg}
        h = d.get("heights")
        if isinstance(h, (int, float)) and h and h > _MIN_JUMP_M:
            samples.append(
                {
                    "time": d.get("timestamp"),
                    "height_m": float(h),
                    "lat": _semicircles_to_deg(d.get("position_lat")),
                    "lng": _semicircles_to_deg(d.get("position_long")),
                    "speed_ms": d.get("enhanced_speed"),
                    "jump_tuple": d.get("jump"),
                    "jumpchart": d.get("jumpchart"),
                    "jump_ts": d.get("timestamps"),
                }
            )
    return samples


def group_jumps(samples: list[dict]) -> list[dict]:
    """Group time-ordered jump samples into individual jumps (peak per run),
    sorted biggest-first. Pure function over sample dicts."""
    groups: list[list[dict]] = []
    cur: list[dict] = []
    for s in samples:
        if not cur or (s["time"] - cur[-1]["time"]).total_seconds() <= _JUMP_GAP_S:
            cur.append(s)
        else:
            groups.append(cur)
            cur = [s]
    if cur:
        groups.append(cur)

    jumps = []
    for g in groups:
        peak = max(g, key=lambda x: x["height_m"])
        jump = {
            "height_m": round(peak["height_m"], 2),
            "lat": round(peak["lat"], 6) if peak["lat"] is not None else None,
            "lng": round(peak["lng"], 6) if peak["lng"] is not None else None,
            "time": peak["time"].isoformat() if hasattr(peak["time"], "isoformat") else peak["time"],
        }
        # Rich per-jump data from the Surfr CIQ developer fields (exact match with
        # Surfr's corrected output — validated). Falls back gracefully when absent.
        tup = peak.get("jump_tuple")
        if tup and len(tup) >= 4 and tup[0] and tup[0] > 0:
            jump["airtime_s"] = round(float(tup[1]), 2)
            jump["distance_m"] = round(float(tup[2]), 1)
            jump["approach_speed_kn"] = round(float(tup[3]) * MS_TO_KNOTS, 1)
        elif peak.get("speed_ms"):
            # NB: never derive airtime from the heights-run span — it lingers past
            # the real airtime and overestimates badly.
            jump["approach_speed_kn"] = round(peak["speed_ms"] * MS_TO_KNOTS, 1)
        chart = peak.get("jumpchart")
        if chart:
            vals = [v / 100 for v in chart]
            last = max((i for i, v in enumerate(vals) if v > 0), default=-1)
            if last >= 0:
                # Keep one bounding zero on each side (takeoff/landing on the water).
                jump["trajectory_m"] = [0.0] + [round(v, 2) for v in vals[1 : last + 1]] + [0.0]
        ts = peak.get("jump_ts")
        if ts and len(ts) >= 3 and ts[1] and ts[2]:
            jump["takeoff_ts"] = int(ts[1])
            jump["landing_ts"] = int(ts[2])
        jumps.append(jump)
    jumps.sort(key=lambda j: j["height_m"], reverse=True)
    return jumps


# Seconds of on-water context captured around each jump's flight path.
_PATH_LEAD_S = 3


def _read_track(fit_path: str) -> list[tuple[int, float, float]]:
    """(unix_ts, lat, lng) for every 1Hz record with a GPS fix.

    FIT record timestamps are NAIVE UTC datetimes; `.timestamp()` on a naive
    value assumes local time and shifts by the machine's UTC offset, breaking
    the match against the dev-field unix timestamps. Force UTC explicitly.
    """
    from datetime import timezone

    fit = fitparse.FitFile(fit_path)
    track = []
    for msg in fit.get_messages("record"):
        d = {x.name: x.value for x in msg}
        lat = _semicircles_to_deg(d.get("position_lat"))
        lng = _semicircles_to_deg(d.get("position_long"))
        t = d.get("timestamp")
        if lat and lng and t is not None:
            track.append((int(t.replace(tzinfo=timezone.utc).timestamp()), lat, lng))
    return track


def attach_jump_paths(jumps: list[dict], track: list[tuple[int, float, float]], top_n: int = 3) -> None:
    """Attach the real flight-window GPS path (takeoff-3s .. landing+3s, 1Hz) to
    the top N jumps: `path` = [[t_rel_s_from_takeoff, lat, lng], ...]."""
    if not track:
        return
    for j in jumps[:top_n]:
        t0, t1 = j.get("takeoff_ts"), j.get("landing_ts")
        if not t0 or not t1:
            continue
        window = [
            [ts - t0, round(lat, 6), round(lng, 6)]
            for ts, lat, lng in track
            if t0 - _PATH_LEAD_S <= ts <= t1 + _PATH_LEAD_S
        ]
        if len(window) >= 3:
            j["path"] = window


def extract_jumps_from_fit(fit_path: str) -> list[dict]:
    """Per-jump {height_m, lat, lng, time, airtime, trajectory, path} from a FIT,
    biggest-first.

    Uses only the per-record `heights` developer field, never the glitchy
    session-level `maxheight`.
    """
    jumps = group_jumps(_read_jump_samples(fit_path))
    attach_jump_paths(jumps, _read_track(fit_path))
    return jumps


def parse_surfr_description(description: str | None) -> list[dict]:
    """Parse Surfr's 'Top 5 Jumps' block into per-jump corrected detail."""
    if not description:
        return []
    out = []
    for m in _SURFR_JUMP_RE.finditer(description):
        rank, h, air, dist, kmh = m.groups()
        out.append(
            {
                "rank": int(rank),
                "height_m": float(h),
                "airtime_s": float(air),
                "distance_m": int(dist),
                "approach_speed_kn": round(int(kmh) * KMH_TO_KNOTS, 1),
            }
        )
    return out


def assemble_jumps(jumps: list[dict], surfr_description: str | None = None) -> dict:
    """Rank jumps, enrich the top ones with Surfr airtime/distance (matched by
    rank, height-guarded), and compute the session summary. Pure function."""
    surfr = parse_surfr_description(surfr_description)
    for i, j in enumerate(jumps):
        j["rank"] = i + 1
        s = next((s for s in surfr if s["rank"] == i + 1), None)
        if s and abs(s["height_m"] - j["height_m"]) <= _SURFR_MATCH_TOL_M:
            # Native airtime/distance (from the CIQ `jump` tuple) match Surfr's
            # corrected values exactly, so Surfr's text is only a fallback for
            # old sessions plus a cross-check marker.
            j.setdefault("airtime_s", s["airtime_s"])
            j.setdefault("distance_m", s["distance_m"])
            j["surfr_height_m"] = s["height_m"]

    # Spot name + session max-airtime from Surfr's description when available.
    spot = None
    surfr_max_air = None
    if surfr_description:
        m = _SURFR_SPOT_RE.search(surfr_description)
        if m:
            spot = m.group(1)
        m = _SURFR_MAXAIR_RE.search(surfr_description)
        if m:
            surfr_max_air = float(m.group(1))
    # Native per-jump airtimes are Surfr-accurate; Surfr's text is the fallback.
    airtimes = [j["airtime_s"] for j in jumps if j.get("airtime_s")]
    max_airtime = max(airtimes) if airtimes else surfr_max_air

    heights = [j["height_m"] for j in jumps]
    summary = {
        "jump_count": len(jumps),
        "max_height_m": max(heights) if heights else None,
        "avg_height_m": round(sum(heights) / len(heights), 2) if heights else None,
        "total_height_m": round(sum(heights), 1) if heights else None,
        "max_airtime_s": max_airtime,
        "spot": spot,
        "surfr_matched": bool(surfr),
    }
    return {"jumps": jumps, "summary": summary}


def build_kite_jumps(fit_path: str, surfr_description: str | None = None) -> dict:
    """Assemble the stored jump payload from a FIT path + optional Surfr text."""
    return assemble_jumps(extract_jumps_from_fit(fit_path), surfr_description)
