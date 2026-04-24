"""Fat floor enforcement — hormonal protection (M1.5).

Research basis:
- Whittaker & Wu 2021 meta: <20% of calories from fat → 10-15% total T drop
- Volek 1997, Wang 2005: hormonal disruption below ~0.6-0.8 g/kg
- Helms 2014 contest prep: 0.8 g/kg recommended minimum

Modes:
- standard / aggressive: floor 0.8 soft / 0.6 hard (non-negotiable)
- maintenance: 1.0 g/kg soft (real target with headroom), 0.6 hard
- bulk: 0.8 g/kg soft (floor stays); up to 1.2 g/kg acceptable as target

Fat is treated as a FLOOR, not a target. Overshoot is safe — no warnings
when fat exceeds the soft floor (treat like protein).
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Literal

Mode = Literal["standard", "aggressive", "maintenance", "bulk"]

FAT_FLOOR_SOFT_DEFAULT: float = 0.8  # g/kg
FAT_FLOOR_HARD: float = 0.6          # g/kg (never breachable)
FAT_TARGET_MAINTENANCE: float = 1.0  # g/kg (real target in maintenance)


class FatBreachType(str, Enum):
    NONE = "none"
    SOFT = "soft"  # below soft, above hard — warning
    HARD = "hard"  # below hard — enforced raise


@dataclass(frozen=True)
class FatFloorResult:
    soft_floor_g: int
    hard_floor_g: int
    fat_g: int = 0
    breach_type: FatBreachType = FatBreachType.NONE


def _soft_floor_g_per_kg(mode: Mode) -> float:
    if mode == "maintenance":
        return FAT_TARGET_MAINTENANCE
    # standard, aggressive, bulk all use 0.8 g/kg soft floor
    return FAT_FLOOR_SOFT_DEFAULT


def compute_fat_floor(weight_kg: float, mode: Mode) -> FatFloorResult:
    """Compute fat floor for a given weight and mode."""
    if mode not in ("standard", "aggressive", "maintenance", "bulk"):
        raise ValueError(f"Unknown mode: {mode!r}")
    if weight_kg <= 0:
        raise ValueError(f"weight_kg must be positive, got {weight_kg}")

    soft_per_kg = _soft_floor_g_per_kg(mode)
    return FatFloorResult(
        soft_floor_g=round(soft_per_kg * weight_kg),
        hard_floor_g=round(FAT_FLOOR_HARD * weight_kg),
    )


def apply_fat_floor(fat_g: int, weight_kg: float, mode: Mode) -> FatFloorResult:
    """Apply fat floor to a proposed fat intake.

    - Above soft → NONE (no warning on overshoot)
    - Between hard and soft → SOFT (warning, not enforced)
    - Below hard → HARD (raised to hard floor)
    """
    floors = compute_fat_floor(weight_kg=weight_kg, mode=mode)

    if fat_g < floors.hard_floor_g:
        breach = FatBreachType.HARD
        adjusted = floors.hard_floor_g
    elif fat_g < floors.soft_floor_g:
        breach = FatBreachType.SOFT
        adjusted = fat_g  # warn but don't enforce
    else:
        breach = FatBreachType.NONE
        adjusted = fat_g

    return FatFloorResult(
        soft_floor_g=floors.soft_floor_g,
        hard_floor_g=floors.hard_floor_g,
        fat_g=adjusted,
        breach_type=breach,
    )
