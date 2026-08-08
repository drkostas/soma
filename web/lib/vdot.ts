/**
 * Daniels/Gilbert VDOT engine — re-exported from the standalone `banister` npm
 * package (single source of truth). Shim; the logic lives in the package.
 *
 * banister ships the exact Python-parity port of `training_engine/vdot.py`
 * (pace ints via `pyRound` = Python round-half-to-even). This file used to carry
 * its own copy that rounded with `Math.round` (half-up); the shim removes that
 * duplication and the rounding drift. Consumers import the same symbols as before.
 */
export {
  vdotFromRace,
  velocityAtVo2max,
  timeFromVdot,
  ZONE_VO2MAX_FRACTIONS,
  percentVo2maxForZone,
  paceForZone,
  allPaces,
  hmGoalPaces,
  adjustVdotForWeight,
} from "banister";

// Back-compat: soma called this interface `Paces`; banister exports it as `DanielsPaces`.
export type { DanielsPaces as Paces } from "banister";
