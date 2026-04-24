"""Deficit duration counter with severity-scaled thresholds (M1.7).

Research basis:
- Byrne 2018 MATADOR (2wk deficit + 2wk maintenance intermittent beats continuous)
- Peos 2021 ICECAP (reactive threshold for athletes)
- Trexler 2014 metabolic adaptation review

Counter increments on deficit days (intake < 95% TDEE) and resets on
prolonged maintenance periods. Severity scaling adjusts thresholds:
- >25% TDEE deficit: tightens by 4 weeks
- <15% TDEE deficit: extends by 4 weeks
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

# Intake ≥ this fraction of TDEE is considered maintenance (aligns with V14 refeed rule).
DEFICIT_RATIO_THRESHOLD: float = 0.95

# Default thresholds (days) at 15-25% deficit
_DEFAULT_SOFT_WARN: int = 56
_DEFAULT_STRONG: int = 84
_DEFAULT_HARD_STOP: int = 112

# Severity scaling offset (in days)
_SEVERITY_OFFSET_DAYS: int = 28  # ±4 weeks

# Reset rules
_FULL_RESET_MAINTENANCE_DAYS: int = 7
_HALF_RESET_MIN_DAYS: int = 3  # 3-6 maintenance days = half reset


class CounterStatus(str, Enum):
    GREEN = "green"
    WARN = "warn"
    STRONG = "strong"
    HARD_STOP = "hard_stop"


@dataclass(frozen=True)
class DurationThresholds:
    soft_warn_days: int
    strong_recommend_days: int
    hard_stop_days: int


def _is_deficit_day(day: dict) -> bool:
    intake = day.get("intake_kcal", 0)
    tdee = day.get("tdee_kcal", 0)
    if tdee <= 0:
        return False
    return intake < DEFICIT_RATIO_THRESHOLD * tdee


def compute_counter(days: list[dict]) -> int:
    """Walk the day history (oldest first) and compute current deficit streak.

    Each day dict needs ``intake_kcal`` and ``tdee_kcal`` keys. A day is in
    deficit when ``intake_kcal < 0.95 × tdee_kcal``.

    Reset rules:
    - 7+ consecutive maintenance days: counter = 0 (full reset)
    - 3-6 consecutive maintenance days: counter //= 2 (half reset)
    - <3 consecutive maintenance days: no reset
    """
    counter = 0
    maintenance_streak = 0

    for day in days:
        if _is_deficit_day(day):
            # Apply pending maintenance streak rules before incrementing
            if maintenance_streak >= _FULL_RESET_MAINTENANCE_DAYS:
                counter = 0
            elif maintenance_streak >= _HALF_RESET_MIN_DAYS:
                counter = counter // 2
            # <3 maintenance days: no reset
            maintenance_streak = 0
            counter += 1
        else:
            maintenance_streak += 1

    return counter


def get_thresholds(avg_deficit_pct: float) -> DurationThresholds:
    """Return duration thresholds adjusted for deficit severity.

    avg_deficit_pct is the average deficit as a percentage of TDEE.
    - >25: tighten by 4 weeks
    - <15: extend by 4 weeks
    - 15-25: default (56/84/112)
    """
    if avg_deficit_pct > 25.0:
        offset = -_SEVERITY_OFFSET_DAYS
    elif avg_deficit_pct < 15.0:
        offset = +_SEVERITY_OFFSET_DAYS
    else:
        offset = 0

    return DurationThresholds(
        soft_warn_days=_DEFAULT_SOFT_WARN + offset,
        strong_recommend_days=_DEFAULT_STRONG + offset,
        hard_stop_days=_DEFAULT_HARD_STOP + offset,
    )


def classify_counter(counter: int, thresholds: DurationThresholds) -> CounterStatus:
    """Classify the current counter against severity-scaled thresholds."""
    if counter >= thresholds.hard_stop_days:
        return CounterStatus.HARD_STOP
    if counter >= thresholds.strong_recommend_days:
        return CounterStatus.STRONG
    if counter >= thresholds.soft_warn_days:
        return CounterStatus.WARN
    return CounterStatus.GREEN
