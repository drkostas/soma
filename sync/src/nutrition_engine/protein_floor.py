"""Protein floor warning + per-meal quality thresholds (M1.6 + V9.1).

Research basis:
- Morton 2018 meta: 1.6 g/kg plateau for resistance-training FFM gains
- Schoenfeld & Aragon 2018: per-meal 0.4 g/kg as optimal
- Trommelen 2023: 100g doses have extended anabolic effect — no upper cap

Behavior:
- Daily intake floor: 1.6 × weight_kg
- Amber warning banner when intake < floor for 3+ consecutive days
- Per-meal quality levels for MPS signaling (informational, not enforced)
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

PROTEIN_FLOOR_G_PER_KG: float = 1.6

# Per-meal thresholds (g)
_PER_MEAL_RED_MAX: int = 14       # <15g = RED
_PER_MEAL_AMBER_MAX: int = 24     # 15-24 = AMBER
_PER_MEAL_YELLOW_MAX: int = 29    # 25-29 = YELLOW
_PER_MEAL_GREEN_MAX: int = 55     # 30-55 = GREEN; >55 = NO_WARNING


class ProteinFloorStatus(str, Enum):
    GREEN = "green"
    AMBER = "amber"


class PerMealProteinLevel(str, Enum):
    RED = "red"
    AMBER = "amber"
    YELLOW = "yellow"
    GREEN = "green"
    NO_WARNING = "no_warning"


@dataclass(frozen=True)
class ProteinFloorResult:
    floor_g: int
    days_below_floor: int  # consecutive streak at end of history
    status: ProteinFloorStatus


def compute_protein_floor(weight_kg: float) -> int:
    """Return the daily protein floor in grams for a given body weight."""
    if weight_kg <= 0:
        raise ValueError(f"weight_kg must be positive, got {weight_kg}")
    return round(PROTEIN_FLOOR_G_PER_KG * weight_kg)


def check_protein_floor(
    recent_intakes: list[float],
    weight_kg: float,
) -> ProteinFloorResult:
    """Check if protein intake has been below floor for 3+ consecutive recent days.

    Args:
        recent_intakes: daily protein totals in grams, oldest first, newest last.
        weight_kg: user weight.

    Returns AMBER when the trailing streak (days ending at most recent) is >= 3.
    """
    floor = compute_protein_floor(weight_kg=weight_kg)

    # Count consecutive days below floor ending at the most recent day
    streak = 0
    for intake in reversed(recent_intakes):
        if intake < floor:
            streak += 1
        else:
            break

    status = ProteinFloorStatus.AMBER if streak >= 3 else ProteinFloorStatus.GREEN
    return ProteinFloorResult(
        floor_g=floor,
        days_below_floor=streak,
        status=status,
    )


def check_per_meal_protein(protein_g: int) -> PerMealProteinLevel:
    """Classify a single meal's protein content per V9.1 MPS quality thresholds."""
    if protein_g <= _PER_MEAL_RED_MAX:
        return PerMealProteinLevel.RED
    if protein_g <= _PER_MEAL_AMBER_MAX:
        return PerMealProteinLevel.AMBER
    if protein_g <= _PER_MEAL_YELLOW_MAX:
        return PerMealProteinLevel.YELLOW
    if protein_g <= _PER_MEAL_GREEN_MAX:
        return PerMealProteinLevel.GREEN
    return PerMealProteinLevel.NO_WARNING
