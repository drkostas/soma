/**
 * Muscle-group constants for the mobile Workouts body map. The exercise→muscle
 * mapping itself runs server-side (web /api/workouts/bodymap ports
 * getBodyMapVolumes), so the app only needs labels, colors, display order, and
 * the mapping from our groups to react-native-body-highlighter's SVG slugs.
 */
export type MuscleGroup =
  | "chest" | "back" | "shoulders" | "biceps" | "triceps" | "forearms"
  | "quads" | "hamstrings" | "glutes" | "calves" | "core";

export const ALL_MUSCLE_GROUPS: MuscleGroup[] = [
  "chest", "back", "shoulders", "biceps", "triceps", "forearms",
  "quads", "hamstrings", "glutes", "calves", "core",
];

export const MUSCLE_LABELS: Record<MuscleGroup, string> = {
  chest: "Chest", back: "Back", shoulders: "Shoulders", biceps: "Biceps",
  triceps: "Triceps", forearms: "Forearms", quads: "Quads", hamstrings: "Hamstrings",
  glutes: "Glutes", calves: "Calves", core: "Core",
};

export const MUSCLE_COLORS: Record<MuscleGroup, string> = {
  chest: "#ef4444", back: "#22c55e", shoulders: "#f97316", biceps: "#06b6d4",
  triceps: "#a855f7", forearms: "#ec4899", quads: "#3b82f6", hamstrings: "#8b5cf6",
  glutes: "#f59e0b", calves: "#10b981", core: "#eab308",
};

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
