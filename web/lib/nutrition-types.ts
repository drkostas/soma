/**
 * Shared nutrition types.
 *
 * Scientific invariant — referenced everywhere per-slot budgets appear:
 *
 *   Daily: kcal (soft ceiling when cutting), protein (floor, no ceiling),
 *   fiber (25g floor + 60g ceiling), carbs/fat (emergent).
 *
 *   Per-meal: ONLY kcal is softly paced across slots. Protein has an MPS
 *   quality signal based on absolute grams per eating event (≥30g optimal),
 *   never proportional to daily. Carbs/fat/fiber have no per-meal caps.
 *
 *   Refs: Schoenfeld & Aragon 2018; Trommelen 2023; V9.1.
 *
 * Encoding this invariant in the type means any code that tries to read
 * `slotBudget.protein` is a compile error. Keep it that way.
 */

export interface SlotBudget {
  calories: number;
}

export type SlotBudgets = Record<string, SlotBudget>;

/** MPS floor per eating event. Not proportional to daily target. */
export const PROTEIN_MPS_FLOOR_G = 30;
