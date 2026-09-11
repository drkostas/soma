/**
 * Muscle groups for the app: the mapping, labels, hex colours and the volume
 * aggregation come from hevy2garmin (one table for the dashboard and the
 * app). This file keeps only the app's own extras: the mapping from our
 * groups to react-native-body-highlighter's SVG slugs, and an rgba helper.
 */
import { MUSCLE_HEX, ALL_MUSCLE_GROUPS, aggregateMuscleVolumes, type MuscleGroup } from "hevy2garmin/muscle-groups";

export { ALL_MUSCLE_GROUPS, MUSCLE_LABELS, getExerciseMuscles, aggregateMuscleVolumes } from "hevy2garmin/muscle-groups";
export type { MuscleGroup, MuscleMapping } from "hevy2garmin/muscle-groups";

export const MUSCLE_COLORS: Record<MuscleGroup, string> = MUSCLE_HEX;
/** The app's historical name for the package's aggregator. */
export const aggregateWorkoutMuscles = aggregateMuscleVolumes;

/** Our groups → react-native-body-highlighter slugs (rn uses a single
 *  `deltoids`, `hamstring` singular, and splits back into upper/lower/traps). */
export const MUSCLE_TO_SLUGS: Record<MuscleGroup, string[]> = {
  chest: ["chest"],
  back: ["upper-back", "lower-back", "trapezius"],
  shoulders: ["deltoids"],
  biceps: ["biceps"],
  triceps: ["triceps"],
  forearms: ["forearm"],
  quads: ["quadriceps"],
  hamstrings: ["hamstring"],
  glutes: ["gluteal"],
  calves: ["calves"],
  core: ["abs", "obliques"],
};

export const SLUG_TO_MUSCLE: Record<string, MuscleGroup> = (() => {
  const r: Record<string, MuscleGroup> = {};
  for (const mg of ALL_MUSCLE_GROUPS) for (const slug of MUSCLE_TO_SLUGS[mg]) r[slug] = mg;
  return r;
})();

export function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha)).toFixed(2)})`;
}
