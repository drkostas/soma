"""Forbes partitioning of body-weight change into FFM and FM (M3.1).

Research basis:
- Forbes 2000 FFM-FM curve: `dFFM/dBW = 10.4 / (10.4 + FM)`
- Recomp multiplier: concurrent resistance training + ≥1.8 g/kg protein
  biases partitioning toward muscle gain / spares FFM during a cut. We apply
  a 0.6× scalar to the baseline FFM fraction per V2 §8.1 (MATADOR / Helms
  recomp reviews).
"""

from __future__ import annotations

from dataclasses import dataclass


# Forbes 2000 curve constant — do not change without revisiting the research.
_FORBES_K: float = 10.4

# V2 §8.1 recomp multiplier on the FFM fraction.
_RECOMP_MULTIPLIER: float = 0.6


@dataclass(frozen=True)
class ForbesResult:
    d_ffm_kg: float
    d_fm_kg: float
    ffm_fraction: float


def partition_weight_change(
    d_bw_kg: float,
    fm_kg: float,
    *,
    recomp: bool = False,
) -> ForbesResult:
    """Split a body-weight change into FFM and FM components via Forbes.

    The fat-mass variable is the *current* FM, not the target. Callers that
    want an integrated prediction across a multi-day window should integrate
    in small steps and re-estimate `fm_kg` each step.
    """
    if fm_kg < 0:
        raise ValueError(f"fm_kg must be non-negative, got {fm_kg}")

    base_fraction = _FORBES_K / (_FORBES_K + fm_kg)
    ffm_fraction = base_fraction * _RECOMP_MULTIPLIER if recomp else base_fraction

    d_ffm = d_bw_kg * ffm_fraction
    d_fm = d_bw_kg - d_ffm

    return ForbesResult(d_ffm_kg=d_ffm, d_fm_kg=d_fm, ffm_fraction=ffm_fraction)
