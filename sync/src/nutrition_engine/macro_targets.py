"""M4 Phase A — Macro Engine core (5-band × tier × mode).

Research basis: V2 §2. Replaces the legacy fill-remainder calc with a
periodized model that weights training load into per-band carb targets, then
enforces tier × mode protein minimums and fat floors.

Modules composed:
- Tier (M1.1) — BF% band
- Mode (M2.1) — Standard/Aggressive/Reverse/Maintenance/Bulk/Injured
- Band (this module) — 5-tier training load classifier
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from nutrition_engine.mode import Mode
from nutrition_engine.tier import Tier


# ---------------------------------------------------------------------------
# M4.1 Training load + band classifier
# ---------------------------------------------------------------------------


class Band(str, Enum):
    REST = "rest"
    LIGHT = "light"
    MODERATE = "moderate"
    HARD = "hard"
    VERY_HARD = "very_hard"


_RUN_DIVISOR: int = 10
_GYM_DIVISOR: int = 6
_LOAD_SATURATION: float = 4.0
_ENDURANCE_PRIORITY_THRESHOLD: float = 1.5


def compute_training_load(run_kcal: float, gym_kcal: float, *, weight_kg: float) -> float:
    """Normalize run + gym calories into a per-kg load score.

    Endurance priority: once run_load alone ≥ 1.5, we ignore gym to avoid
    double-counting a hard run + easy lift (V2 §2.3). Saturation at 4.0
    prevents absurd days from escaping the carb-band ladder.
    """
    if run_kcal < 0 or gym_kcal < 0:
        raise ValueError(f"kcal must be ≥ 0, got run={run_kcal} gym={gym_kcal}")
    if weight_kg <= 0:
        raise ValueError(f"weight_kg must be positive, got {weight_kg}")

    run_load = run_kcal / (weight_kg * _RUN_DIVISOR)
    gym_load = gym_kcal / (weight_kg * _GYM_DIVISOR)

    if run_load >= _ENDURANCE_PRIORITY_THRESHOLD:
        return run_load

    return min(run_load + gym_load, _LOAD_SATURATION)


def classify_band(total_load: float) -> Band:
    """Bucket a load score into a band. Thresholds match the V2 §2.3 matrix."""
    if total_load <= 0:
        return Band.REST
    if total_load <= 1.0:
        return Band.LIGHT
    if total_load <= 2.0:
        return Band.MODERATE
    if total_load <= 3.0:
        return Band.HARD
    return Band.VERY_HARD


# ---------------------------------------------------------------------------
# M4.2 Protein formula
# ---------------------------------------------------------------------------

# V2 §2.1 matrix — canonical base g/kg per (tier, mode). Aggressive at T3+ is
# gate-blocked by M2, so we never reach those cells at runtime, but we keep a
# defensive fallback value here so the matrix is total.
_PROTEIN_BASE_G_PER_KG: dict[tuple[Tier, Mode], float] = {
    # Standard
    (Tier.T1, Mode.STANDARD): 2.0,
    (Tier.T2, Mode.STANDARD): 2.3,
    (Tier.T3, Mode.STANDARD): 2.4,
    (Tier.T4, Mode.STANDARD): 2.8,
    (Tier.T5, Mode.STANDARD): 2.8,
    # Aggressive (T1-T2 only by gating; fallback for the unreachable rows)
    (Tier.T1, Mode.AGGRESSIVE): 2.2,
    (Tier.T2, Mode.AGGRESSIVE): 2.4,
    (Tier.T3, Mode.AGGRESSIVE): 2.4,
    (Tier.T4, Mode.AGGRESSIVE): 2.4,
    (Tier.T5, Mode.AGGRESSIVE): 2.4,
    # Reverse — treat like Standard at the same tier
    (Tier.T1, Mode.REVERSE): 2.0,
    (Tier.T2, Mode.REVERSE): 2.3,
    (Tier.T3, Mode.REVERSE): 2.4,
    (Tier.T4, Mode.REVERSE): 2.8,
    (Tier.T5, Mode.REVERSE): 2.8,
    # Maintenance: flat 2.0 g/kg (V2 §2.1)
    (Tier.T1, Mode.MAINTENANCE): 2.0,
    (Tier.T2, Mode.MAINTENANCE): 2.0,
    (Tier.T3, Mode.MAINTENANCE): 2.0,
    (Tier.T4, Mode.MAINTENANCE): 2.0,
    (Tier.T5, Mode.MAINTENANCE): 2.0,
    # Bulk: flat 2.0 g/kg (V2 §6.1)
    (Tier.T1, Mode.BULK): 2.0,
    (Tier.T2, Mode.BULK): 2.0,
    (Tier.T3, Mode.BULK): 2.0,
    (Tier.T4, Mode.BULK): 2.0,
    (Tier.T5, Mode.BULK): 2.0,
    # Injured: use the Standard matrix for this milestone (V2 §4.5 refines
    # later with injury-phase specifics).
    (Tier.T1, Mode.INJURED): 2.0,
    (Tier.T2, Mode.INJURED): 2.3,
    (Tier.T3, Mode.INJURED): 2.4,
    (Tier.T4, Mode.INJURED): 2.8,
    (Tier.T5, Mode.INJURED): 2.8,
}

# V2 §2.1: VERY_HARD band drops protein 0.2 g/kg to make room for carbs.
_VERY_HARD_PROTEIN_DROP: float = 0.2

# Floor per Morton 2018: always ≥ 1.6 g/kg.
_PROTEIN_ABSOLUTE_FLOOR: float = 1.6


def protein_g_per_kg(tier: Tier, mode: Mode, band: Band) -> float:
    """Return the base protein g/kg for this (tier, mode, band) cell."""
    base = _PROTEIN_BASE_G_PER_KG[(tier, mode)]
    if band == Band.VERY_HARD:
        base -= _VERY_HARD_PROTEIN_DROP
    return max(_PROTEIN_ABSOLUTE_FLOOR, base)


# ---------------------------------------------------------------------------
# M4.3 Carbs + fiber
# ---------------------------------------------------------------------------

# V2 §2.3 band-periodized carb ladder (g/kg).
_CARB_G_PER_KG: dict[Band, float] = {
    Band.REST: 3.0,
    Band.LIGHT: 3.5,
    Band.MODERATE: 5.0,
    Band.HARD: 6.5,
    Band.VERY_HARD: 8.0,
}

# V2 §2.3 health floor for athletes in deficit.
_CARB_HEALTH_FLOOR_G: int = 100

# V2 §2.4 fiber: 14 g per 1000 kcal + 5 g bonus during a deficit, with a
# hard ceiling at 60 g (phytate mineral absorption concern).
_FIBER_MIN_G: int = 25
_FIBER_HARD_CEILING_G: int = 60
_FIBER_CUT_BONUS_G: int = 5


def carb_g_per_kg(band: Band) -> float:
    return _CARB_G_PER_KG[band]


def carb_target_g(band: Band, *, weight_kg: float, in_deficit: bool) -> int:
    raw = round(_CARB_G_PER_KG[band] * weight_kg)
    if band == Band.REST and in_deficit:
        # Health floor only applies on rest days in a deficit — training days
        # already blow past 100 g from the band formula itself.
        return max(raw, _CARB_HEALTH_FLOOR_G)
    return raw


def fiber_target_g(kcal_target: int, *, in_deficit: bool) -> int:
    base = max(_FIBER_MIN_G, round(kcal_target * 14 / 1000))
    if in_deficit:
        base += _FIBER_CUT_BONUS_G
    return min(_FIBER_HARD_CEILING_G, base)


# ---------------------------------------------------------------------------
# M4.4 Composed macro engine
# ---------------------------------------------------------------------------

# V2 §1.5 Atwater factors (TEF already embedded).
_KCAL_PER_G_PROTEIN: int = 4
_KCAL_PER_G_CARB: int = 4
_KCAL_PER_G_FAT: int = 9

# V2 §2.2 fat policy: 0.8 soft floor, 0.6 hard floor, Maintenance 1.0 target,
# Bulk 1.0 target (midpoint of 0.8-1.2).
_FAT_HARD_FLOOR_G_PER_KG: float = 0.6
_FAT_SOFT_FLOOR_G_PER_KG: float = 0.8
_FAT_MAINTENANCE_TARGET_G_PER_KG: float = 1.0
_FAT_BULK_TARGET_G_PER_KG: float = 1.0


@dataclass(frozen=True)
class MacroTargets:
    kcal: int
    protein_g: int
    carbs_g: int
    fat_g: int
    fiber_g: int


def _fat_target_for_mode(mode: Mode, weight_kg: float) -> float:
    """Mode-aware fat target (g). Cuts use the soft floor; maintenance and
    bulk set a real target above the floor."""
    if mode == Mode.MAINTENANCE:
        return _FAT_MAINTENANCE_TARGET_G_PER_KG * weight_kg
    if mode == Mode.BULK:
        return _FAT_BULK_TARGET_G_PER_KG * weight_kg
    return _FAT_SOFT_FLOOR_G_PER_KG * weight_kg


def compute_macro_targets(
    *,
    weight_kg: float,
    tier: Tier,
    mode: Mode,
    band: Band,
    kcal_target: int,
    in_deficit: bool,
) -> MacroTargets:
    """Run the full macro stack for a (user, day) and return gram targets.

    Order:
    1. Protein from the tier × mode × band matrix (absolute floor 1.6 g/kg).
    2. Carbs from the band ladder (health floor 100 g on rest days in deficit).
    3. Fat: aim for the mode-aware target; if kcal_target doesn't leave room,
       fall back to the hard floor 0.6 g/kg (M1.5 / V2 §2.2).
    4. Kcal is reported as protein×4 + carbs×4 + fat×9; callers can compare
       this against their intended kcal_target for rounding slack.
    5. Fiber per V2 §2.4.
    """
    # 1) Protein is non-negotiable — matrix target stands.
    protein_g = round(protein_g_per_kg(tier, mode, band) * weight_kg)
    fiber_g = fiber_target_g(kcal_target, in_deficit=in_deficit)

    # 2) Fat target is mode-aware; clamp to hard floor.
    fat_mode_target = _fat_target_for_mode(mode, weight_kg)
    fat_hard_floor = _FAT_HARD_FLOOR_G_PER_KG * weight_kg
    fat_g = max(fat_hard_floor, fat_mode_target)

    # 3) Carbs fill the remainder, with the band target as the CEILING (V2
    # §2.3 band numbers are cut targets — don't overshoot when budget allows
    # more) and the rest-day health floor 100 g when in deficit.
    band_ceiling = _CARB_G_PER_KG[band] * weight_kg
    remainder_kcal = kcal_target - protein_g * _KCAL_PER_G_PROTEIN - fat_g * _KCAL_PER_G_FAT
    carbs_by_remainder = max(0.0, remainder_kcal / _KCAL_PER_G_CARB)
    carbs_g_float = min(carbs_by_remainder, band_ceiling)

    # 4) If tight kcal target pushed carbs below the rest-day health floor,
    # shave fat toward the hard floor to make room.
    if band == Band.REST and in_deficit and carbs_g_float < _CARB_HEALTH_FLOOR_G:
        kcal_for_fat = kcal_target - protein_g * _KCAL_PER_G_PROTEIN - _CARB_HEALTH_FLOOR_G * _KCAL_PER_G_CARB
        shaved_fat = max(fat_hard_floor, kcal_for_fat / _KCAL_PER_G_FAT)
        fat_g = shaved_fat
        carbs_g_float = _CARB_HEALTH_FLOOR_G

    carbs_g = round(carbs_g_float)
    fat_g_int = round(fat_g)

    actual_kcal = (
        protein_g * _KCAL_PER_G_PROTEIN
        + carbs_g * _KCAL_PER_G_CARB
        + fat_g_int * _KCAL_PER_G_FAT
    )

    return MacroTargets(
        kcal=actual_kcal,
        protein_g=protein_g,
        carbs_g=carbs_g,
        fat_g=fat_g_int,
        fiber_g=fiber_g,
    )
