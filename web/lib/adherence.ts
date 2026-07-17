/**
 * Weekly deficit adherence — how the achieved deficit over the recent closed
 * days compares to the goal, with a ±10% tolerance band. Display-only: it labels
 * the week, it doesn't change targets.
 */
export type AdherenceStatus = "under" | "on_track" | "over";

export interface Adherence {
  ratio: number;
  status: AdherenceStatus;
  weeklyActual: number;
  weeklyGoal: number;
}

/** ±10% tolerance around the goal deficit. */
export const ADHERENCE_TOLERANCE = 0.1;

/**
 * @param weeklyActualDeficit summed achieved deficit (kcal, positive = deficit) over closed days
 * @param weeklyGoalDeficit   goal deficit for the same number of closed days (kcal, positive)
 */
export function computeWeeklyAdherence(
  weeklyActualDeficit: number,
  weeklyGoalDeficit: number,
): Adherence | null {
  if (weeklyGoalDeficit <= 0) return null;
  const ratio = weeklyActualDeficit / weeklyGoalDeficit;
  const status: AdherenceStatus =
    ratio < 1 - ADHERENCE_TOLERANCE ? "under" : ratio > 1 + ADHERENCE_TOLERANCE ? "over" : "on_track";
  return {
    ratio,
    status,
    weeklyActual: Math.round(weeklyActualDeficit),
    weeklyGoal: Math.round(weeklyGoalDeficit),
  };
}
