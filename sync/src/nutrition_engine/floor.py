"""BMR + RED-S Energy Availability floor enforcement.

Safety rails for target_calories. Based on:
- Cunningham 1980 BMR (primary soft floor)
- Mountjoy 2018 IOC RED-S consensus (EA hard floor: 25 kcal/kg FFM + exercise)

Modes:
- Standard: soft = Cunningham; hard = max(Cunningham, 25·FFM + ex_kcal). Both enforced.
- Aggressive: soft = Cunningham (advisory); hard = 25·FFM + ex_kcal. Only hard enforced.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Literal

from nutrition_engine.bmr import cunningham

# Mountjoy 2018 RED-S consensus threshold
REDS_EA_COEFFICIENT: int = 25  # kcal per kg FFM per day

Mode = Literal["standard", "aggressive"]


class FloorBreachType(str, Enum):
    NONE = "none"
    SOFT = "soft"
    HARD = "hard"


@dataclass(frozen=True)
class FloorResult:
    """Floor computation result."""
    soft_floor: int
    hard_floor: int
    target_kcal: int = 0
    breach_type: FloorBreachType = FloorBreachType.NONE


def compute_floor(
    ffm_kg: float,
    exercise_kcal: float,
    mode: Mode,
) -> FloorResult:
    """Compute soft + hard floors for a given FFM, exercise level, and mode.

    Standard mode:
        soft = Cunningham(FFM)
        hard = max(Cunningham, 25·FFM + exercise)

    Aggressive mode:
        soft = Cunningham(FFM)  [advisory only]
        hard = 25·FFM + exercise  [Cunningham dropped]
    """
    if mode not in ("standard", "aggressive"):
        raise ValueError(f"Unknown mode: {mode!r}. Use 'standard' or 'aggressive'.")
    if ffm_kg <= 0:
        raise ValueError(f"ffm_kg must be positive, got {ffm_kg}")
    if exercise_kcal < 0:
        raise ValueError(f"exercise_kcal must be non-negative, got {exercise_kcal}")

    soft = cunningham(ffm_kg=ffm_kg)
    ea_threshold = round(REDS_EA_COEFFICIENT * ffm_kg + exercise_kcal)

    if mode == "standard":
        hard = max(soft, ea_threshold)
    else:  # aggressive
        hard = ea_threshold

    return FloorResult(soft_floor=soft, hard_floor=hard)


def apply_floor(
    target_kcal: int,
    ffm_kg: float,
    exercise_kcal: float,
    mode: Mode,
) -> FloorResult:
    """Apply floor to a proposed target_kcal.

    Returns FloorResult with:
    - ``target_kcal`` adjusted to hard_floor if it was breached
    - ``breach_type`` indicating NONE, SOFT, or HARD

    Semantics:
    - Standard mode: target below soft == target below hard (soft=hard in this mode
      when soft dominates). Both breach types can fire.
    - Aggressive mode: target below Cunningham but above hard = SOFT breach (warning),
      target below hard = HARD breach (enforced raise).
    """
    floors = compute_floor(ffm_kg=ffm_kg, exercise_kcal=exercise_kcal, mode=mode)

    if target_kcal < floors.hard_floor:
        breach = FloorBreachType.HARD
        adjusted = floors.hard_floor
    elif target_kcal < floors.soft_floor:
        # Only reachable in aggressive mode (hard < soft).
        breach = FloorBreachType.SOFT
        adjusted = target_kcal  # allowed to stay below soft in aggressive
    else:
        breach = FloorBreachType.NONE
        adjusted = target_kcal

    return FloorResult(
        soft_floor=floors.soft_floor,
        hard_floor=floors.hard_floor,
        target_kcal=adjusted,
        breach_type=breach,
    )
