/**
 * Comprehensive exercise → muscle group mapping with primary and secondary targets.
 * Based on standard exercise science / Hevy / Garmin classifications.
 */

export type MuscleGroup =
  | "chest"
  | "back"
  | "shoulders"
  | "biceps"
  | "triceps"
  | "forearms"
  | "quads"
  | "hamstrings"
  | "glutes"
  | "calves"
  | "core";

export interface MuscleMapping {
  primary: MuscleGroup[];
  secondary: MuscleGroup[];
}

// Exact match mapping for all known exercises
const EXERCISE_MAP: Record<string, MuscleMapping> = {
  // --- CHEST ---
  "Bench Press (Barbell)":          { primary: ["chest"], secondary: ["triceps", "shoulders"] },
  "Incline Bench Press (Barbell)":  { primary: ["chest"], secondary: ["shoulders", "triceps"] },
  "Chest Dip":                      { primary: ["chest"], secondary: ["triceps", "shoulders"] },
  "Chest Dip (Weighted)":           { primary: ["chest"], secondary: ["triceps", "shoulders"] },
  "Chest Dip (Assisted)":           { primary: ["chest"], secondary: ["triceps", "shoulders"] },
  "Chest Fly (Machine)":            { primary: ["chest"], secondary: [] },
  "Chest Fly (Band)":               { primary: ["chest"], secondary: [] },
  "Push Up (Weighted)":             { primary: ["chest"], secondary: ["triceps", "shoulders"] },

  // --- BACK ---
  "Iso-Lateral Row (Machine)":      { primary: ["back"], secondary: ["biceps"] },
  "Iso-Lateral Low Row":            { primary: ["back"], secondary: ["biceps"] },
  "Pull Up":                        { primary: ["back"], secondary: ["biceps"] },
  "Pull Up (Assisted)":             { primary: ["back"], secondary: ["biceps"] },
  "Pull Up (Weighted)":             { primary: ["back"], secondary: ["biceps"] },
  "Bent Over Row (Barbell)":        { primary: ["back"], secondary: ["biceps", "core"] },
  "Chest Supported Incline Row (Dumbbell)": { primary: ["back"], secondary: ["biceps"] },
  "Lat Pulldown (Cable)":           { primary: ["back"], secondary: ["biceps"] },
  "Lat Pulldown (Machine)":         { primary: ["back"], secondary: ["biceps"] },
  "Reverse Grip Lat Pulldown (Cable)": { primary: ["back"], secondary: ["biceps"] },
  "Seated Cable Row - V Grip (Cable)": { primary: ["back"], secondary: ["biceps"] },
  "Straight Arm Lat Pulldown (Cable)": { primary: ["back"], secondary: [] },
  "Deadlift (Barbell)":             { primary: ["back", "hamstrings"], secondary: ["glutes", "core", "forearms"] },
  "Back Extension (Weighted Hyperextension)": { primary: ["back"], secondary: ["glutes", "hamstrings"] },
  "Back Extension (Hyperextension)": { primary: ["back"], secondary: ["glutes", "hamstrings"] },

  // --- SHOULDERS ---
  "Overhead Press (Barbell)":       { primary: ["shoulders"], secondary: ["triceps", "core"] },
  "Seated Overhead Press (Barbell)": { primary: ["shoulders"], secondary: ["triceps"] },
  "Seated Shoulder Press (Machine)": { primary: ["shoulders"], secondary: ["triceps"] },
  "Shoulder Press (Dumbbell)":      { primary: ["shoulders"], secondary: ["triceps"] },
  "Arnold Press (Dumbbell)":        { primary: ["shoulders"], secondary: ["triceps"] },
  "Lateral Raise (Dumbbell)":       { primary: ["shoulders"], secondary: [] },
  "Lateral Raise (Machine)":        { primary: ["shoulders"], secondary: [] },
  "Lateral Raise (Cable)":          { primary: ["shoulders"], secondary: [] },
  "Front Raise (Dumbbell)":         { primary: ["shoulders"], secondary: [] },
  "Front Raise (Barbell)":          { primary: ["shoulders"], secondary: [] },
  "Face Pull":                      { primary: ["shoulders"], secondary: ["back"] },
  "Rear Deltoid":                   { primary: ["shoulders"], secondary: ["back"] },
  "Rear Delt Reverse Fly (Machine)": { primary: ["shoulders"], secondary: ["back"] },
  "Rear Delt Reverse Fly (Cable)":  { primary: ["shoulders"], secondary: ["back"] },
  "Chest Supported Reverse Fly (Dumbbell)": { primary: ["shoulders"], secondary: ["back"] },
  "Shoulder Extension":             { primary: ["shoulders"], secondary: [] },
  "Shrug (Dumbbell)":               { primary: ["shoulders"], secondary: [] },

  // --- BICEPS ---
  "Hammer Curl (Dumbbell)":         { primary: ["biceps"], secondary: ["forearms"] },
  "Preacher Curl (Barbell)":        { primary: ["biceps"], secondary: [] },
  "Concentration Curl":             { primary: ["biceps"], secondary: [] },
  "Bicep Curl (Barbell)":           { primary: ["biceps"], secondary: [] },
  "Bicep Curl (Dumbbell)":          { primary: ["biceps"], secondary: [] },
  "Bicep Curl (Cable)":             { primary: ["biceps"], secondary: [] },
  "Reverse EZ-Bar Curl":            { primary: ["biceps"], secondary: ["forearms"] },

  // --- TRICEPS ---
  "Triceps Pushdown":               { primary: ["triceps"], secondary: [] },
  "Triceps Extension (Cable)":      { primary: ["triceps"], secondary: [] },
  "One-Arm Cable Cross Body Triceps Extension": { primary: ["triceps"], secondary: [] },
  "Overhead Triceps Extension (Cable)": { primary: ["triceps"], secondary: [] },

  // --- FOREARMS ---
  "Seated Palms Up Wrist Curl":     { primary: ["forearms"], secondary: [] },

  // --- QUADS ---
  "Leg Extension (Machine)":        { primary: ["quads"], secondary: [] },
  "Leg Press (Machine)":            { primary: ["quads", "glutes"], secondary: ["hamstrings", "calves"] },

  // --- HAMSTRINGS ---
  "Seated Leg Curl (Machine)":      { primary: ["hamstrings"], secondary: [] },
  "Lying Leg Curl (Machine)":       { primary: ["hamstrings"], secondary: [] },
  "Romanian Deadlift (Barbell)":    { primary: ["hamstrings"], secondary: ["glutes", "back"] },

  // --- GLUTES ---
  "Hip Abduction (Machine)":        { primary: ["glutes"], secondary: [] },
  "Hip Adduction (Machine)":        { primary: ["glutes"], secondary: [] },

  // --- CALVES ---
  "Calf Press (Machine)":           { primary: ["calves"], secondary: [] },
  "Seated Calf Raise":              { primary: ["calves"], secondary: [] },

  // --- CORE ---
  "Crunch (Weighted)":              { primary: ["core"], secondary: [] },
  "Crunch":                         { primary: ["core"], secondary: [] },
  "Crunch (Machine)":               { primary: ["core"], secondary: [] },
  "Hanging Leg Raise":              { primary: ["core"], secondary: [] },
  "Leg Raise Parallel Bars":        { primary: ["core"], secondary: [] },
  "Lying Leg Raise":                { primary: ["core"], secondary: [] },
  "Side Bend (Dumbbell)":           { primary: ["core"], secondary: [] },
  "Plank":                          { primary: ["core"], secondary: ["shoulders"] },
  "Russian Twist (Bodyweight)":     { primary: ["core"], secondary: [] },
  "Superman":                       { primary: ["core"], secondary: ["back", "glutes"] },
  "Torso Rotation":                 { primary: ["core"], secondary: [] },
};

/**
 * Get primary and secondary muscle groups for an exercise.
 * Falls back to ILIKE-style pattern matching for unknown exercises.
 */
export function getExerciseMuscles(exerciseName: string): MuscleMapping {
  // Exact match
  const exact = EXERCISE_MAP[exerciseName];
  if (exact) return exact;

  // Pattern fallback for unknown exercises
  const lower = exerciseName.toLowerCase();
  if (lower.includes("bench") || lower.includes("chest") || lower.includes("push up"))
    return { primary: ["chest"], secondary: ["triceps"] };
  if (lower.includes("row") || lower.includes("pull up") || lower.includes("lat ") || lower.includes("pulldown"))
    return { primary: ["back"], secondary: ["biceps"] };
  if (lower.includes("shoulder") || lower.includes("overhead press") || lower.includes("lateral raise") || lower.includes("front raise") || lower.includes("face pull") || lower.includes("rear delt") || lower.includes("reverse fly") || lower.includes("shrug"))
    return { primary: ["shoulders"], secondary: [] };
  if (lower.includes("curl") || lower.includes("hammer") || lower.includes("preacher") || lower.includes("concentration"))
    return { primary: ["biceps"], secondary: [] };
  if (lower.includes("tricep") || lower.includes("pushdown"))
    return { primary: ["triceps"], secondary: [] };
  if (lower.includes("deadlift") || lower.includes("back extension"))
    return { primary: ["back"], secondary: ["hamstrings"] };
  if (lower.includes("leg press") || lower.includes("leg extension") || lower.includes("squat"))
    return { primary: ["quads"], secondary: ["glutes"] };
  if (lower.includes("leg curl") || lower.includes("romanian"))
    return { primary: ["hamstrings"], secondary: ["glutes"] };
  if (lower.includes("hip"))
    return { primary: ["glutes"], secondary: [] };
  if (lower.includes("calf"))
    return { primary: ["calves"], secondary: [] };
  if (lower.includes("crunch") || lower.includes("plank") || lower.includes("leg raise") || lower.includes("twist") || lower.includes("superman") || lower.includes("torso"))
    return { primary: ["core"], secondary: [] };
  if (lower.includes("wrist"))
    return { primary: ["forearms"], secondary: [] };
  if (lower.includes("dip"))
    return { primary: ["chest"], secondary: ["triceps", "shoulders"] };

  return { primary: [], secondary: [] };
}

/**
 * Human-readable labels for muscle groups
 */
export const MUSCLE_LABELS: Record<MuscleGroup, string> = {
  chest: "Chest",
  back: "Back",
  shoulders: "Shoulders",
  biceps: "Biceps",
  triceps: "Triceps",
  forearms: "Forearms",
  quads: "Quads",
  hamstrings: "Hamstrings",
  glutes: "Glutes",
  calves: "Calves",
  core: "Core",
};

/**
 * Colors for each muscle group (hex for SVG, Tailwind class for UI)
 */
export const MUSCLE_COLORS: Record<MuscleGroup, { hex: string; tw: string }> = {
  chest:      { hex: "#ef4444", tw: "bg-red-500" },
  back:       { hex: "#22c55e", tw: "bg-green-500" },
  shoulders:  { hex: "#f97316", tw: "bg-orange-500" },
  biceps:     { hex: "#06b6d4", tw: "bg-cyan-500" },
  triceps:    { hex: "#a855f7", tw: "bg-purple-500" },
  forearms:   { hex: "#ec4899", tw: "bg-pink-500" },
  quads:      { hex: "#3b82f6", tw: "bg-blue-500" },
  hamstrings: { hex: "#8b5cf6", tw: "bg-violet-500" },
  glutes:     { hex: "#f59e0b", tw: "bg-amber-500" },
  calves:     { hex: "#10b981", tw: "bg-emerald-500" },
  core:       { hex: "#eab308", tw: "bg-yellow-500" },
};

/**
 * All muscle groups in display order
 */
export const ALL_MUSCLE_GROUPS: MuscleGroup[] = [
  "chest", "back", "shoulders", "biceps", "triceps", "forearms",
  "quads", "hamstrings", "glutes", "calves", "core",
];

/**
 * Aggregate muscle volumes from exercises.
 * Returns a map of muscle group → { primary: number, secondary: number }
 * weight = 1.0 for primary muscles, 0.33 for secondary (proportional contribution)
 */
export function aggregateMuscleVolumes(
  exercises: { title: string; sets: { type: string; weight_kg: number; reps: number }[] }[]
): Record<MuscleGroup, { primary: number; secondary: number; total: number }> {
  const result: Record<MuscleGroup, { primary: number; secondary: number; total: number }> = {} as any;
  for (const mg of ALL_MUSCLE_GROUPS) {
    result[mg] = { primary: 0, secondary: 0, total: 0 };
  }

  for (const ex of exercises) {
    const mapping = getExerciseMuscles(ex.title);
    let exVolume = 0;
    let exSets = 0;
    for (const s of ex.sets) {
      if (s.type === "normal" && s.weight_kg > 0 && s.reps > 0) {
        exVolume += s.weight_kg * s.reps;
        exSets++;
      }
    }
    if (exSets === 0) continue;

    for (const mg of mapping.primary) {
      result[mg].primary += exVolume;
      result[mg].total += exVolume;
    }
    for (const mg of mapping.secondary) {
      const contrib = exVolume * 0.33;
      result[mg].secondary += contrib;
      result[mg].total += contrib;
    }
  }

  return result;
}
