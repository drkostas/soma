/**
 * Muscle groups for the web: the mapping, labels, hex colours and volume
 * aggregation come from hevy2garmin (one table for the dashboard and the
 * app); this file only adds the Tailwind class per group that the web's
 * components use next to the hex.
 */
import { MUSCLE_HEX, type MuscleGroup } from "hevy2garmin/muscle-groups";

export { ALL_MUSCLE_GROUPS, MUSCLE_LABELS, MUSCLE_HEX, getExerciseMuscles, aggregateMuscleVolumes } from "hevy2garmin/muscle-groups";
export type { MuscleGroup, MuscleMapping } from "hevy2garmin/muscle-groups";

export const MUSCLE_COLORS: Record<MuscleGroup, { hex: string; tw: string }> = {
  chest: { hex: MUSCLE_HEX.chest, tw: "bg-red-500" },
  back: { hex: MUSCLE_HEX.back, tw: "bg-green-500" },
  shoulders: { hex: MUSCLE_HEX.shoulders, tw: "bg-orange-500" },
  biceps: { hex: MUSCLE_HEX.biceps, tw: "bg-cyan-500" },
  triceps: { hex: MUSCLE_HEX.triceps, tw: "bg-purple-500" },
  forearms: { hex: MUSCLE_HEX.forearms, tw: "bg-pink-500" },
  quads: { hex: MUSCLE_HEX.quads, tw: "bg-blue-500" },
  hamstrings: { hex: MUSCLE_HEX.hamstrings, tw: "bg-violet-500" },
  glutes: { hex: MUSCLE_HEX.glutes, tw: "bg-amber-500" },
  calves: { hex: MUSCLE_HEX.calves, tw: "bg-emerald-500" },
  core: { hex: MUSCLE_HEX.core, tw: "bg-yellow-500" },
};
