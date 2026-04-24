"""Mode × tier × BF% availability gate (M2.2).

Decides whether a user is allowed to enter a given mode given their current
tier and BF% estimate, returning a typed reason when blocked so the UI can
render a specific explanation rather than a generic "not allowed" banner.

Research basis: Nutrition Science v2 §3.2 (Aggressive hard floor at 12% BF,
T1-T2 only), §6 (Bulk tier gate), §4.5 (Injured overrides all gates).
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from nutrition_engine.mode import Mode, get_mode_config
from nutrition_engine.tier import Tier


class GateReason(str, Enum):
    TIER_NOT_ALLOWED = "tier_not_allowed"
    BF_BELOW_HARD_FLOOR = "bf_below_hard_floor"


@dataclass(frozen=True)
class ModeAvailability:
    allowed: bool
    reason: GateReason | None


def check_mode_availability(
    mode: Mode,
    tier: Tier,
    *,
    bf_pct: float,
) -> ModeAvailability:
    """Return whether `mode` is legal for the given `tier` and `bf_pct`.

    When blocked, `reason` identifies the first gate that tripped so the
    caller can render specific copy.
    """
    config = get_mode_config(mode)

    if tier not in config.tier_allowed:
        return ModeAvailability(allowed=False, reason=GateReason.TIER_NOT_ALLOWED)

    # BF% hard floor: strictly below the floor AND AT the floor are both blocked.
    # At 12.0% BF the user is already in contraindication territory per V2 §3.2.
    if config.bf_hard_floor_pct is not None and bf_pct <= config.bf_hard_floor_pct:
        return ModeAvailability(allowed=False, reason=GateReason.BF_BELOW_HARD_FLOOR)

    return ModeAvailability(allowed=True, reason=None)
