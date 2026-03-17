/**
 * Client-side portion solver for compose meals.
 * Priority: protein first → carbs → fat → vegetables fill volume.
 */

export interface Ingredient {
  id: string;
  name: string;
  calories_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  fiber_per_100g: number;
  category: string;
  is_raw?: boolean;
  raw_to_cooked_ratio?: number | null;
  unit?: string; // 'g' (default), 'egg', 'gel', etc.
  grams_per_unit?: number | null; // grams per 1 unit (e.g., 50 for eggs)
}

/** Check if an ingredient uses count-based units instead of grams */
export function isCountBased(ing: Ingredient): boolean {
  return !!ing.unit && ing.unit !== "g" && !!ing.grams_per_unit;
}

/** Convert count to grams */
export function countToGrams(ing: Ingredient, count: number): number {
  return count * (ing.grams_per_unit || 100);
}

/** Convert grams to count */
export function gramsToCount(ing: Ingredient, grams: number): number {
  return Math.round(grams / (ing.grams_per_unit || 100));
}

export interface MacroTarget {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface PortionResult {
  ingredient_id: string;
  grams: number;
  increment: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
}

/** Per-category gram adjustment increments (for +/- buttons). */
const INCREMENTS: Record<string, number> = {
  protein: 25,
  carbs: 10,
  vegetable: 25,
  fat: 5,
  dairy: 25,
  sauce: 10,
  fruit: 25,
  supplement: 5,
};

/** Per-category gram bounds [min, max]. */
const BOUNDS: Record<string, [number, number]> = {
  protein: [50, 300],
  carbs: [30, 200],
  vegetable: [50, 250],
  fat: [5, 100],
  dairy: [25, 300],
  sauce: [20, 80],
  fruit: [50, 200],
  supplement: [10, 60],
};

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function macrosAt(ing: Ingredient, grams: number) {
  const f = grams / 100;
  return {
    calories: f * ing.calories_per_100g,
    protein: f * ing.protein_per_100g,
    carbs: f * ing.carbs_per_100g,
    fat: f * ing.fat_per_100g,
    fiber: f * ing.fiber_per_100g,
  };
}

export function solvePortions(
  ingredients: Ingredient[],
  target: MacroTarget,
): PortionResult[] {
  const proteins = ingredients.filter((i) => i.category === "protein");
  const carbSources = ingredients.filter((i) => ["carbs", "fruit"].includes(i.category));
  const fatSources = ingredients.filter((i) => ["fat", "dairy"].includes(i.category));
  const vegs = ingredients.filter((i) => i.category === "vegetable");
  const sauces = ingredients.filter((i) => i.category === "sauce");
  const supplements = ingredients.filter((i) => i.category === "supplement");

  const portions: Record<string, number> = {};
  const remaining = { ...target };

  // Step 1: Protein sources → hit protein target
  if (proteins.length > 0 && remaining.protein > 0) {
    const perSource = remaining.protein / proteins.length;
    for (const ing of proteins) {
      if (ing.protein_per_100g <= 0) continue;
      const [lo, hi] = BOUNDS.protein;
      const grams = clamp((perSource / ing.protein_per_100g) * 100, lo, hi);
      portions[ing.id] = Math.round(grams);
      const m = macrosAt(ing, grams);
      remaining.protein -= m.protein;
      remaining.carbs -= m.carbs;
      remaining.fat -= m.fat;
      remaining.calories -= m.calories;
    }
  }

  // Step 2: Carb sources → hit remaining carb target
  if (carbSources.length > 0 && remaining.carbs > 0) {
    const perSource = remaining.carbs / carbSources.length;
    for (const ing of carbSources) {
      if (ing.carbs_per_100g <= 0) continue;
      const [lo, hi] = BOUNDS[ing.category] ?? BOUNDS.carbs;
      const grams = clamp((perSource / ing.carbs_per_100g) * 100, lo, hi);
      portions[ing.id] = Math.round(grams);
      const m = macrosAt(ing, grams);
      remaining.fat -= m.fat;
      remaining.calories -= m.calories;
    }
  }

  // Step 3: Fat sources → hit remaining fat target
  if (fatSources.length > 0 && remaining.fat > 0) {
    const perSource = remaining.fat / fatSources.length;
    for (const ing of fatSources) {
      if (ing.fat_per_100g <= 0) continue;
      const [lo, hi] = BOUNDS[ing.category] ?? BOUNDS.fat;
      const grams = clamp((perSource / ing.fat_per_100g) * 100, lo, hi);
      portions[ing.id] = Math.round(grams);
    }
  }

  // Step 4: Vegetables → standard 120g
  for (const ing of vegs) { portions[ing.id] = 120; }

  // Step 5: Sauces → standard 50g
  for (const ing of sauces) { portions[ing.id] = 50; }

  // Step 6: Supplements → 1 serving
  for (const ing of supplements) {
    portions[ing.id] = ing.id === "protein_powder_whey" ? 30 : 35;
  }

  // Build results with computed macros
  return ingredients.map((ing) => {
    const grams = portions[ing.id] ?? 100;
    const m = macrosAt(ing, grams);
    return {
      ingredient_id: ing.id,
      grams,
      increment: INCREMENTS[ing.category] ?? 10,
      calories: Math.round(m.calories),
      protein: Math.round(m.protein * 10) / 10,
      carbs: Math.round(m.carbs * 10) / 10,
      fat: Math.round(m.fat * 10) / 10,
      fiber: Math.round(m.fiber * 10) / 10,
    };
  });
}

/** Recompute macros for a single ingredient at a given gram amount. */
export function computeItemMacros(ing: Ingredient, grams: number) {
  const m = macrosAt(ing, grams);
  return {
    calories: Math.round(m.calories),
    protein: Math.round(m.protein * 10) / 10,
    carbs: Math.round(m.carbs * 10) / 10,
    fat: Math.round(m.fat * 10) / 10,
    fiber: Math.round(m.fiber * 10) / 10,
  };
}

/** Convert between raw and cooked grams using the ingredient's ratio. */
export function rawToCooked(ing: Ingredient, rawGrams: number): number {
  const ratio = ing.raw_to_cooked_ratio;
  if (!ing.is_raw || !ratio || ratio <= 0) return rawGrams;
  return Math.round(rawGrams * ratio);
}

export function cookedToRaw(ing: Ingredient, cookedGrams: number): number {
  const ratio = ing.raw_to_cooked_ratio;
  if (!ing.is_raw || !ratio || ratio <= 0) return cookedGrams;
  return Math.round(cookedGrams / ratio);
}

/** Check if an ingredient supports cooked weight toggle. */
export function hasRawCookedToggle(ing: Ingredient): boolean {
  return !!ing.is_raw && !!ing.raw_to_cooked_ratio && ing.raw_to_cooked_ratio > 0 && ing.raw_to_cooked_ratio !== 1;
}

/** Sum macros across a list of portion results. */
export function sumPortionMacros(portions: PortionResult[]) {
  return {
    calories: Math.round(portions.reduce((s, p) => s + p.calories, 0)),
    protein: Math.round(portions.reduce((s, p) => s + p.protein, 0)),
    carbs: Math.round(portions.reduce((s, p) => s + p.carbs, 0)),
    fat: Math.round(portions.reduce((s, p) => s + p.fat, 0)),
    fiber: Math.round(portions.reduce((s, p) => s + p.fiber, 0)),
  };
}
