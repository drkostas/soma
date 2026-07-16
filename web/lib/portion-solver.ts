// Re-export from macro-engine-core (single source of truth). Shim; logic lives in the package.
export { type Ingredient, type PerMealSolverTarget, type PortionResult, computeItemMacros, cookedToRaw, countToGrams, gramsToCount, hasRawCookedToggle, isCountBased, rawToCooked, solvePortions, sumPortionMacros } from "macro-engine-core";
