# sync/src/bpm_formula.py
"""HR → music BPM formula based on Karvonen %HRR.

Research basis:
- Karageorghis et al. (2009, 2011): HR preference increases with intensity
- CADENCE-Adults (Bravata et al.): piecewise HR-cadence relationship
- JND (Weber's law): 5 BPM steps are below conscious detection threshold
"""
import time

# Piecewise anchors: (pct_hrr, target_bpm)
# Linear interpolation between adjacent anchors.
_ANCHORS = [
    (0.00, 75),
    (0.10, 85),
    (0.20, 95),
    (0.30, 105),
    (0.40, 118),
    (0.45, 124),
    (0.50, 128),
    (0.55, 132),
    (0.60, 136),
    (0.65, 140),
    (0.70, 145),
    (0.75, 150),
    (0.80, 155),
    (0.85, 162),
    (0.90, 168),
    (0.95, 175),
    (1.00, 175),
]

BPM_FLOOR = 70
BPM_CEILING = 185


def hrr_to_bpm(
    hr: float,
    hr_rest: float = 60.0,
    hr_max: float = 190.0,
    offset: int = 0,
) -> int:
    """Convert heart rate to target music BPM via %HRR piecewise formula."""
    pct = (hr - hr_rest) / max(hr_max - hr_rest, 1)

    # Out-of-range HR: return hard floor/ceiling directly (before interpolation).
    if pct < 0.0:
        return BPM_FLOOR
    if pct > 1.0:
        return BPM_CEILING

    for i in range(len(_ANCHORS) - 1):
        lo_pct, lo_bpm = _ANCHORS[i]
        hi_pct, hi_bpm = _ANCHORS[i + 1]
        if lo_pct <= pct <= hi_pct:
            t = (pct - lo_pct) / (hi_pct - lo_pct) if hi_pct > lo_pct else 0
            bpm = lo_bpm + t * (hi_bpm - lo_bpm)
            return int(max(BPM_FLOOR, min(BPM_CEILING, round(bpm) + offset)))

    return BPM_CEILING if pct >= 1.0 else BPM_FLOOR


def latest_hr_from_garmin_data(
    data: dict,
    window_seconds: int = 120,
) -> int | None:
    """Extract the most recent valid HR reading within the time window.

    Garmin returns: {"heartRateValues": [[timestamp_ms, bpm_or_null], ...]}
    """
    readings = data.get("heartRateValues") or []
    now_ms = int(time.time() * 1000)
    cutoff_ms = now_ms - window_seconds * 1000

    for timestamp_ms, hr_value in reversed(readings):
        if hr_value is None:
            continue
        if timestamp_ms >= cutoff_ms:
            return int(hr_value)

    return None
