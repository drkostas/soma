"""M10 Phase A — Weekly wrap-up aggregator.

Pure function over a list of per-day records → single-week snapshot with
adherence grade + auto-generated takeaway string.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import List, Optional


# Adherence: a closed day "hits" when |actual - target| / target <= 10%.
_ADHERENCE_TOLERANCE: float = 0.10


@dataclass(frozen=True)
class DayRecord:
    day: date
    target_kcal: int
    actual_kcal: int
    protein_g: float
    weight_kg: Optional[float] = None
    had_training: bool = False
    was_closed: bool = True


@dataclass(frozen=True)
class WeeklyWrapup:
    week_start: Optional[date]
    week_end: Optional[date]
    days_total: int
    days_closed: int
    adherence_pct: int  # rounded integer 0-100
    avg_kcal: int  # closed-day average, 0 if no closed days
    avg_protein_g: int
    avg_protein_g_per_kg: float
    training_days: int
    weight_delta_kg: Optional[float]
    grade: str = field(default="F")
    # takeaway generated separately (expensive pure fn; keep data clean)


def _day_hits_target(d: DayRecord) -> bool:
    if d.target_kcal <= 0:
        return False
    diff = abs(d.actual_kcal - d.target_kcal) / d.target_kcal
    return diff <= _ADHERENCE_TOLERANCE


def adherence_grade(pct: float) -> str:
    """A >=90, B >=80, C >=70, D >=60, F below."""
    if pct >= 90:
        return "A"
    if pct >= 80:
        return "B"
    if pct >= 70:
        return "C"
    if pct >= 60:
        return "D"
    return "F"


def compute_weekly_wrapup(
    days: List[DayRecord],
    *,
    weight_kg: float,
) -> WeeklyWrapup:
    if not days:
        return WeeklyWrapup(
            week_start=None, week_end=None,
            days_total=0, days_closed=0,
            adherence_pct=0,
            avg_kcal=0, avg_protein_g=0, avg_protein_g_per_kg=0.0,
            training_days=0,
            weight_delta_kg=None,
            grade="F",
        )

    ordered = sorted(days, key=lambda d: d.day)
    closed = [d for d in ordered if d.was_closed]
    hits = sum(1 for d in closed if _day_hits_target(d))
    adherence_pct = round(100 * hits / len(closed)) if closed else 0

    avg_kcal = round(sum(d.actual_kcal for d in closed) / len(closed)) if closed else 0
    avg_protein_g = round(sum(d.protein_g for d in closed) / len(closed)) if closed else 0
    avg_protein_g_per_kg = round(
        (avg_protein_g / weight_kg) if weight_kg > 0 else 0.0, 2,
    )

    training_days = sum(1 for d in ordered if d.had_training)

    # Weight delta uses first and last days with a weight reading.
    weights = [(d.day, d.weight_kg) for d in ordered if d.weight_kg is not None]
    weight_delta_kg: Optional[float] = None
    if len(weights) >= 2:
        weight_delta_kg = round(weights[-1][1] - weights[0][1], 2)

    return WeeklyWrapup(
        week_start=ordered[0].day,
        week_end=ordered[-1].day,
        days_total=len(ordered),
        days_closed=len(closed),
        adherence_pct=adherence_pct,
        avg_kcal=avg_kcal,
        avg_protein_g=avg_protein_g,
        avg_protein_g_per_kg=avg_protein_g_per_kg,
        training_days=training_days,
        weight_delta_kg=weight_delta_kg,
        grade=adherence_grade(adherence_pct),
    )


def wrapup_takeaway(w: WeeklyWrapup) -> str:
    """One-sentence human-readable commentary on the week."""
    if w.days_total == 0:
        return "Not enough data yet — close a few days to see your weekly wrap-up."
    if w.days_closed == 0:
        return "No closed days this week. Close a day to build your adherence score."

    parts: List[str] = []
    if w.adherence_pct >= 90:
        parts.append("Strong week on track")
    elif w.adherence_pct >= 80:
        parts.append("Solid adherence")
    elif w.adherence_pct >= 70:
        parts.append("Mixed week")
    else:
        parts.append("Off track — calories ran over or under target")

    if w.avg_protein_g_per_kg > 0:
        parts.append(f"protein averaged {w.avg_protein_g_per_kg:.1f} g/kg")
    if w.training_days > 0:
        parts.append(f"{w.training_days} training day{'s' if w.training_days != 1 else ''}")
    if w.weight_delta_kg is not None:
        direction = "down" if w.weight_delta_kg < 0 else ("up" if w.weight_delta_kg > 0 else "flat")
        if direction == "flat":
            parts.append("weight flat")
        else:
            parts.append(f"weight {direction} {abs(w.weight_delta_kg):.1f} kg")

    return ". ".join(parts) + "."
