/**
 * Client-side portion solver for compose meals.
 *
 * Contract (post-#81 / #83): target = { calories, proteinMpsFloor? }.
 *
 *   1. Hit the kcal budget with the provided ingredient mix.
 *   2. Ensure total protein ≥ MPS floor (default 30g) when the mix allows it.
 *      If not reachable without busting kcal, kcal wins — the meal just has
 *      low protein and the UI flags it via the MPS quality pill.
 *   3. Carbs / fat / fiber emerge from the ingredient selection. No proportional
 *      per-slot targets — those have no scientific basis (see nutrition-types.ts).
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
  unit?: string;
  grams_per_unit?: number | null;
  unit_step?: number | null;
}

export function isCountBased(ing: Ingredient): boolean {
  return !!ing.unit && ing.unit !== "g" && !!ing.grams_per_unit;
}
export function countToGrams(ing: Ingredient, count: number): number {
  return count * (ing.grams_per_unit || 100);
}
export function gramsToCount(ing: Ingredient, grams: number): number {
  const raw = grams / (ing.grams_per_unit || 100);
  const step = ing.unit_step ?? 0.25;
  return Math.round(raw / step) * step;
}

export interface PerMealSolverTarget {
  calories: number;
  /** MPS floor in grams. Default 30g per Schoenfeld & Aragon 2018. */
  proteinMpsFloor?: number;
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
  protein: 25, carbs: 10, vegetable: 25, fat: 5,
  dairy: 25, sauce: 10, fruit: 25, supplement: 5,
};

/** Per-category gram bounds [min, max]. */
const BOUNDS: Record<string, [number, number]> = {
  protein: [50, 300], carbs: [30, 200], vegetable: [50, 250],
  fat: [5, 100], dairy: [25, 300], sauce: [20, 80],
  fruit: [50, 200], supplement: [10, 60],
};

const FIXED_CATEGORIES = new Set(["vegetable", "sauce", "supplement"]);

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
function fixedSeedGrams(ing: Ingredient): number {
  if (ing.category === "vegetable") return 120;
  if (ing.category === "sauce") return 50;
  if (ing.category === "supplement") {
    return ing.id === "protein_powder_whey" ? 30 : 35;
  }
  return 50;
}

export function solvePortions(
  ingredients: Ingredient[],
  target: PerMealSolverTarget,
): PortionResult[] {
  if (ingredients.length === 0) return [];

  const mpsFloor = target.proteinMpsFloor ?? 30;
  const portions: Record<string, number> = {};

  const fixed = ingredients.filter((i) => FIXED_CATEGORIES.has(i.category));
  const scalable = ingredients.filter((i) => !FIXED_CATEGORIES.has(i.category));

  for (const ing of fixed) portions[ing.id] = fixedSeedGrams(ing);

  // Cap whole eggs at 1 unit up front (one yolk/day).
  const clampWholeEggs = () => {
    const wholeEgg = ingredients.find((i) => i.id === "eggs_whole");
    if (wholeEgg?.grams_per_unit && portions[wholeEgg.id] > wholeEgg.grams_per_unit) {
      portions[wholeEgg.id] = wholeEgg.grams_per_unit;
    }
  };

  // Kcal already consumed by fixed seeds.
  let fixedCal = 0;
  for (const ing of fixed) fixedCal += macrosAt(ing, portions[ing.id]).calories;

  const remCal = Math.max(0, target.calories - fixedCal);

  // Seed scalable ingredients. Give each a share of remCal proportional to its
  // role weight — protein-dense ingredients get more, so the initial guess is
  // already close to MPS without overshooting.
  if (scalable.length > 0 && remCal > 0) {
    const roleWeight = (ing: Ingredient) =>
      ing.protein_per_100g > 5 ? 2 : 1;
    const totalWeight = scalable.reduce((s, ing) => s + roleWeight(ing), 0) || 1;
    for (const ing of scalable) {
      const calShare = remCal * (roleWeight(ing) / totalWeight);
      const grams = ing.calories_per_100g > 0
        ? (calShare / ing.calories_per_100g) * 100
        : 50;
      const [lo, hi] = BOUNDS[ing.category] ?? [10, 300];
      portions[ing.id] = Math.round(clamp(grams, lo, hi));
    }
    clampWholeEggs();
  } else {
    for (const ing of scalable) portions[ing.id] = fixedSeedGrams(ing);
  }

  // Step 1: uniform kcal scaling. Scale all scalable ingredients by the same
  // factor so total kcal lands near target, respecting per-category bounds.
  const scaleScalable = (factor: number) => {
    for (const ing of scalable) {
      const [lo, hi] = BOUNDS[ing.category] ?? [10, 300];
      portions[ing.id] = Math.round(clamp(portions[ing.id] * factor, lo, hi));
    }
    clampWholeEggs();
  };
  const totalKcal = () => {
    let k = 0;
    for (const ing of ingredients) k += macrosAt(ing, portions[ing.id]).calories;
    return k;
  };
  if (scalable.length > 0) {
    for (let i = 0; i < 3; i++) {
      const cur = totalKcal();
      if (cur === 0) break;
      const factor = target.calories / cur;
      if (Math.abs(1 - factor) < 0.02) break;
      scaleScalable(factor);
    }
  }

  // Step 2: MPS floor enforcement. If total protein < floor, boost the most
  // protein-dense scalable ingredient and trim the rest to stay within kcal.
  const totalProtein = () => {
    let p = 0;
    for (const ing of ingredients) p += macrosAt(ing, portions[ing.id]).protein;
    return p;
  };
  const proteinDense = scalable
    .filter((i) => i.protein_per_100g >= 5)
    .sort((a, b) => b.protein_per_100g - a.protein_per_100g);

  if (proteinDense.length > 0) {
    for (let iter = 0; iter < 8 && totalProtein() < mpsFloor - 0.5; iter++) {
      const gap = mpsFloor - totalProtein();
      const target0 = proteinDense[0];
      const [tLo, tHi] = BOUNDS[target0.category] ?? [10, 300];
      const addG = Math.ceil((gap / target0.protein_per_100g) * 100);
      const newG = Math.min(tHi, portions[target0.id] + addG);
      const actuallyAdded = newG - portions[target0.id];
      if (actuallyAdded <= 0) break;

      portions[target0.id] = newG;
      // Compensate by trimming non-protein-dense scalables uniformly.
      const others = scalable.filter((i) => i !== target0);
      if (others.length > 0) {
        const addedKcal = macrosAt(target0, actuallyAdded).calories;
        let toRemove = addedKcal;
        for (const o of others) {
          const [oLo] = BOUNDS[o.category] ?? [10, 300];
          const maxShrinkG = Math.max(0, portions[o.id] - oLo);
          if (maxShrinkG <= 0) continue;
          const oKcalPerG = o.calories_per_100g / 100;
          const shrinkByKcal = Math.min(
            toRemove / others.length,
            maxShrinkG * oKcalPerG,
          );
          if (oKcalPerG > 0) {
            const shrinkG = Math.round(shrinkByKcal / oKcalPerG);
            portions[o.id] = Math.max(oLo, portions[o.id] - shrinkG);
            toRemove -= shrinkG * oKcalPerG;
          }
        }
      }
      clampWholeEggs();
    }
  }

  // Step 3: final kcal fit — if over by >2%, scale down once more.
  const final = totalKcal();
  if (final > target.calories * 1.02 && final > 0) {
    scaleScalable(target.calories / final);
  }

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

export function hasRawCookedToggle(ing: Ingredient): boolean {
  return !!ing.is_raw && !!ing.raw_to_cooked_ratio && ing.raw_to_cooked_ratio > 0 && ing.raw_to_cooked_ratio !== 1;
}

export function sumPortionMacros(portions: PortionResult[]) {
  return {
    calories: Math.round(portions.reduce((s, p) => s + p.calories, 0)),
    protein: Math.round(portions.reduce((s, p) => s + p.protein, 0)),
    carbs: Math.round(portions.reduce((s, p) => s + p.carbs, 0)),
    fat: Math.round(portions.reduce((s, p) => s + p.fat, 0)),
    fiber: Math.round(portions.reduce((s, p) => s + p.fiber, 0)),
  };
}
