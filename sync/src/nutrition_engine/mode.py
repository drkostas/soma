"""6-mode state enum + per-mode configuration (M2.1).

Research basis: Nutrition Science v2 §3.2 (Aggressive), §5 (Maintenance),
§6 (Bulk), §4.5 (Injured).

Modes encode both intent ("what is the user trying to do") and capability
("what are the rails around that intent"). The config per mode captures:
- tier_allowed: which BF% tiers this mode is legal in
- bf_hard_floor_pct: BF% below which the mode is a hard contraindication
- requires_reverse_bridge_from: modes that must pass through REVERSE first
  before entering this mode (cut→bulk transition)
- max_duration_days: advisory upper bound per V2 duration envelopes
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

from nutrition_engine.tier import Tier


class Mode(str, Enum):
    STANDARD = "standard"
    AGGRESSIVE = "aggressive"
    REVERSE = "reverse"
    MAINTENANCE = "maintenance"
    BULK = "bulk"
    INJURED = "injured"


@dataclass(frozen=True)
class ModeConfig:
    tier_allowed: frozenset[Tier]
    bf_hard_floor_pct: float | None
    requires_reverse_bridge_from: frozenset[Mode] = field(default_factory=frozenset)
    max_duration_days: int | None = None


_ALL_TIERS: frozenset[Tier] = frozenset(Tier)


_CONFIGS: dict[Mode, ModeConfig] = {
    Mode.STANDARD: ModeConfig(
        tier_allowed=frozenset({Tier.T1, Tier.T2, Tier.T3, Tier.T4}),
        bf_hard_floor_pct=None,
    ),
    Mode.AGGRESSIVE: ModeConfig(
        tier_allowed=frozenset({Tier.T1, Tier.T2}),
        bf_hard_floor_pct=12.0,
        max_duration_days=84,  # V2 §3.2: 12 weeks at 700-900 kcal envelope
    ),
    Mode.REVERSE: ModeConfig(
        tier_allowed=_ALL_TIERS,
        bf_hard_floor_pct=None,
        max_duration_days=42,  # V2 §3.2: post-aggressive reverse 2-6 weeks
    ),
    Mode.MAINTENANCE: ModeConfig(
        tier_allowed=_ALL_TIERS,
        bf_hard_floor_pct=None,
    ),
    Mode.BULK: ModeConfig(
        tier_allowed=frozenset({Tier.T2, Tier.T3, Tier.T4, Tier.T5}),
        bf_hard_floor_pct=None,
        requires_reverse_bridge_from=frozenset({Mode.STANDARD, Mode.AGGRESSIVE}),
        max_duration_days=140,  # V2 §6.1: 12-20 week bulk block
    ),
    Mode.INJURED: ModeConfig(
        tier_allowed=_ALL_TIERS,
        bf_hard_floor_pct=None,
    ),
}


def get_mode_config(mode: Mode) -> ModeConfig:
    """Return the frozen config for a mode. Raises KeyError if a mode lacks a
    registered config — this is a programmer error, not a runtime condition."""
    return _CONFIGS[mode]
