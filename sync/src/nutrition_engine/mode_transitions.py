"""Mode transition state machine (M2.3).

Pure-function decision layer between "the user wants to switch modes" and
"actually flipping the DB field". Returns a typed reason on block so the UI
can show a specific banner and, when relevant, auto-insert the required
bridge (e.g., a 4-week reverse diet between cut and bulk).

Research basis:
- V2 §3.2: Aggressive block ends with a mandatory 2-6 week reverse diet.
- V2 §6.4: Cut → Bulk requires a reverse bridge; Bulk → Cut abrupt OK;
  Bulk → Maintenance is a user-driven ramp, not enforced here.
- V2 §4.5: Injured mode is always reachable; re-entry runs availability.
- V2 §5.2: Cut → Maintenance 3-week ramp is "preferred, not enforced"
  (evidence is psychological, not metabolic) — so no transition block.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from nutrition_engine.mode import Mode, get_mode_config
from nutrition_engine.mode_availability import check_mode_availability
from nutrition_engine.tier import Tier


class TransitionReason(str, Enum):
    # Destination mode fails its (tier, BF%) availability check.
    MODE_NOT_AVAILABLE = "mode_not_available"
    # V2 §3.2: exiting Aggressive must pass through Reverse first.
    AGGRESSIVE_REQUIRES_REVERSE = "aggressive_requires_reverse"
    # V2 §6.4: entering Bulk from a cut mode requires a reverse bridge.
    REQUIRES_REVERSE_BRIDGE = "requires_reverse_bridge"


@dataclass(frozen=True)
class TransitionResult:
    allowed: bool
    reason: TransitionReason | None = None
    # When a bridge mode is required (e.g. REVERSE between cut and bulk),
    # callers can auto-propose it rather than guessing from the reason.
    requires_bridge: Mode | None = None


def check_transition(
    current: Mode,
    next_mode: Mode,
    *,
    tier: Tier,
    bf_pct: float,
) -> TransitionResult:
    """Return whether a mode transition is legal.

    Order of checks matters — we evaluate cheap invariants before running the
    availability gate so the reason codes stay specific.
    """

    # A no-op transition is always allowed.
    if current == next_mode:
        return TransitionResult(allowed=True)

    # Entering Injured is always legal — injuries don't wait for gating.
    if next_mode == Mode.INJURED:
        return TransitionResult(allowed=True)

    # V2 §6.4: cut → bulk must pass through a reverse bridge. Check this before
    # the generic Aggressive-exit rule so Aggressive → Bulk surfaces the more
    # actionable REQUIRES_REVERSE_BRIDGE reason (carries `requires_bridge`)
    # rather than the bare AGGRESSIVE_REQUIRES_REVERSE code.
    next_config = get_mode_config(next_mode)
    if current in next_config.requires_reverse_bridge_from:
        return TransitionResult(
            allowed=False,
            reason=TransitionReason.REQUIRES_REVERSE_BRIDGE,
            requires_bridge=Mode.REVERSE,
        )

    # V2 §3.2: exiting Aggressive (to anything other than Reverse or Injured)
    # requires the reverse diet. Injured was handled above; Bulk was handled
    # by the bridge check; anything else lands here.
    if current == Mode.AGGRESSIVE and next_mode != Mode.REVERSE:
        return TransitionResult(
            allowed=False,
            reason=TransitionReason.AGGRESSIVE_REQUIRES_REVERSE,
        )

    # Finally, the destination mode must be legal for the user's tier + BF%.
    availability = check_mode_availability(next_mode, tier, bf_pct=bf_pct)
    if not availability.allowed:
        return TransitionResult(
            allowed=False,
            reason=TransitionReason.MODE_NOT_AVAILABLE,
        )

    return TransitionResult(allowed=True)
