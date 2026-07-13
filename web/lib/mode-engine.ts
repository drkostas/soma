// Re-export from macro-engine-core (single source of truth). Shim; logic lives in the package.
export { ALL_MODES, type GateReason, type Mode, type ModeAvailability, type ModeConfig, type TransitionReason, type TransitionResult, checkModeAvailability, checkTransition, getModeConfig } from "macro-engine-core";
