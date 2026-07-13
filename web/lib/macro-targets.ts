// Re-export from macro-engine-core (single source of truth). Shim; logic lives in the package.
export { ALL_BANDS, type Band, type MacroContextResult, type MacroTargets, type MacroTargetsLegacyShape, carbGPerKg, carbTargetG, classifyBand, computeMacroTargets, computeMacroTargetsFromContext, computeTrainingLoad, fiberTargetG, proteinGPerKg } from "macro-engine-core";
