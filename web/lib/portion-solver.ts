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
  /**
   * Simultaneous constraint solver:
   * 1. Assign initial portions based on each ingredient's primary role
   * 2. Compute total macros
   * 3. If any macro exceeds budget, scale ALL portions down proportionally
   * 4. Then iteratively shift grams from over-budget macros to under-budget ones
   */

  const vegs = ingredients.filter((i) => i.category === "vegetable");
  const sauces = ingredients.filter((i) => i.category === "sauce");
  const supplements = ingredients.filter((i) => i.category === "supplement");
  const scalable = ingredients.filter((i) =>
    !["vegetable", "sauce", "supplement"].includes(i.category)
  );

  const portions: Record<string, number> = {};

  // Fixed portions: veggies, sauces, supplements (not optimized)
  for (const ing of vegs) { portions[ing.id] = 120; }
  for (const ing of sauces) { portions[ing.id] = 50; }
  for (const ing of supplements) {
    portions[ing.id] = ing.id === "protein_powder_whey" ? 30 : 35;
  }

  // Compute calories used by fixed ingredients
  let fixedCal = 0, fixedP = 0, fixedC = 0, fixedF = 0;
  for (const ing of [...vegs, ...sauces, ...supplements]) {
    const m = macrosAt(ing, portions[ing.id]);
    fixedCal += m.calories;
    fixedP += m.protein;
    fixedC += m.carbs;
    fixedF += m.fat;
  }

  // Remaining budget for scalable ingredients
  const remCal = Math.max(0, target.calories - fixedCal);
  const remP = Math.max(0, target.protein - fixedP);
  const remC = Math.max(0, target.carbs - fixedC);
  const remF = Math.max(0, target.fat - fixedF);

  if (scalable.length === 0 || remCal <= 0) {
    // Nothing to optimize — just use fixed
    return ingredients.map((ing) => {
      const grams = portions[ing.id] ?? 50;
      const m = macrosAt(ing, grams);
      return {
        ingredient_id: ing.id, grams,
        increment: INCREMENTS[ing.category] ?? 10,
        calories: Math.round(m.calories),
        protein: Math.round(m.protein * 10) / 10,
        carbs: Math.round(m.carbs * 10) / 10,
        fat: Math.round(m.fat * 10) / 10,
        fiber: Math.round(m.fiber * 10) / 10,
      };
    });
  }

  // Step 1: Assign initial portions — each ingredient gets a calorie share
  // proportional to its "role weight" (protein sources get more if protein target is high)
  const roleWeight = (ing: Ingredient): number => {
    const pShare = ing.protein_per_100g > 0 ? (remP * 4) : 0; // cal from protein this ing can help with
    const cShare = ing.carbs_per_100g > 0 ? (remC * 4) : 0;
    const fShare = ing.fat_per_100g > 0 ? (remF * 9) : 0;
    return pShare + cShare + fShare || ing.calories_per_100g;
  };

  const totalRoleWeight = scalable.reduce((s, ing) => s + roleWeight(ing), 0) || 1;

  for (const ing of scalable) {
    const calShare = remCal * (roleWeight(ing) / totalRoleWeight);
    const gramsForCal = ing.calories_per_100g > 0 ? (calShare / ing.calories_per_100g) * 100 : 50;
    const [lo, hi] = BOUNDS[ing.category] ?? [10, 300];
    portions[ing.id] = Math.round(clamp(gramsForCal, lo, hi));
  }

  // Step 2: Check if total exceeds calorie budget, scale down if needed
  const totalMacros = () => {
    let cal = 0, p = 0, c = 0, f = 0;
    for (const ing of scalable) {
      const m = macrosAt(ing, portions[ing.id]);
      cal += m.calories; p += m.protein; c += m.carbs; f += m.fat;
    }
    return { cal, p, c, f };
  };

  let t = totalMacros();

  // Scale down proportionally if over calorie budget
  if (t.cal > remCal && t.cal > 0) {
    const scale = remCal / t.cal;
    for (const ing of scalable) {
      const [lo] = BOUNDS[ing.category] ?? [10, 300];
      portions[ing.id] = Math.max(lo, Math.round(portions[ing.id] * scale));
    }
    t = totalMacros();
  }

  // Step 3: Fine-tune — try to shift grams to better hit protein target
  // If protein is underfilled, increase protein sources slightly at expense of carb/fat sources
  for (let iter = 0; iter < 5; iter++) {
    t = totalMacros();
    const proteinGap = remP - t.p;
    if (proteinGap <= 1) break; // close enough

    // Find a protein source to increase
    const proteinIngs = scalable.filter(i => i.category === "protein" && i.protein_per_100g > 5);
    const carbFatIngs = scalable.filter(i => ["carbs", "fruit", "fat", "dairy"].includes(i.category));

    if (proteinIngs.length === 0 || carbFatIngs.length === 0) break;

    // Increase protein source by 10g, decrease a carb/fat source by equivalent calories
    for (const pIng of proteinIngs) {
      const addGrams = 10;
      const addCal = macrosAt(pIng, addGrams).calories;
      const [, pHi] = BOUNDS[pIng.category] ?? [10, 300];
      if (portions[pIng.id] + addGrams > pHi) continue;

      // Find a carb/fat source to shrink
      for (const cfIng of carbFatIngs) {
        const shrinkGrams = cfIng.calories_per_100g > 0
          ? Math.round((addCal / cfIng.calories_per_100g) * 100)
          : 0;
        const [cfLo] = BOUNDS[cfIng.category] ?? [10, 300];
        if (portions[cfIng.id] - shrinkGrams < cfLo) continue;

        portions[pIng.id] += addGrams;
        portions[cfIng.id] -= shrinkGrams;
        break;
      }
      break; // one shift per iteration
    }
  }

  // Constraint: max 1 whole egg (with yolk) per day — clamp to 1 unit
  const wholeEgg = scalable.find(i => i.id === "eggs_whole");
  if (wholeEgg && wholeEgg.grams_per_unit) {
    const maxGrams = wholeEgg.grams_per_unit; // 1 egg = 50g
    if (portions[wholeEgg.id] > maxGrams) {
      portions[wholeEgg.id] = maxGrams;
    }
  }

  // Final calorie check — scale down again if over
  t = totalMacros();
  if (t.cal > remCal * 1.02 && t.cal > 0) {
    const scale = remCal / t.cal;
    for (const ing of scalable) {
      const [lo] = BOUNDS[ing.category] ?? [10, 300];
      portions[ing.id] = Math.max(lo, Math.round(portions[ing.id] * scale));
    }
  }

  // Build results
  return ingredients.map((ing) => {
    const grams = portions[ing.id] ?? 50;
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
