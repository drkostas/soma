"use client";

import React, { useState, useMemo, useEffect, useRef } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/number-input";
import { ProteinQualityPill } from "@/lib/per-meal-protein";
import type { SlotBudget } from "@/lib/nutrition-types";
import {
  type Ingredient,
  type PortionResult,
  computeItemMacros,
  sumPortionMacros,
  rawToCooked,
  cookedToRaw,
  hasRawCookedToggle,
  isCountBased,
  countToGrams,
  gramsToCount,
} from "@/lib/portion-solver";

interface DayMacros {
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  calories: number;
}

interface ComposeMealViewProps {
  portions: PortionResult[];
  ingredients: Ingredient[];
  budget: SlotBudget | null;
  /** Daily P/C/F/Fi/kcal targets (the scalar daily target, not slot-pacing). */
  dayTargets?: DayMacros | null;
  /** Daily P/C/F/Fi/kcal consumed BEFORE this meal (excludes the meal being edited).
   *  Renders as the *darker* segment of each bar so the user can see how this meal
   *  stacks on top of what they've already logged today. */
  dayConsumed?: DayMacros | null;
  /** User's body weight (kg). Used to compute protein g/kg and fat g/kg goalposts. */
  weightKg?: number | null;
  /** Today's total burn (BMR + steps + workouts). Used as the "maintenance" goalpost
   *  on the kcal bar — the gap from daily kcal target to total burn = today's deficit. */
  totalBurn?: number | null;
  onLog: (
    items: { ingredient_id: string; grams: number; calories: number; protein: number; carbs: number; fat: number; fiber: number }[],
    totals: { calories: number; protein: number; carbs: number; fat: number; fiber: number },
  ) => void;
  onCancel: () => void;
  onEditIngredients?: () => void;
  logging?: boolean;
  onTotalsChange?: (totals: { calories: number; protein: number; carbs: number; fat: number; fiber: number }) => void;
}

/** Health floor for daily carbs (mirrors CARB_HEALTH_FLOOR_G in macro-targets.ts). */
const CARB_HEALTH_FLOOR_G = 100;
/** Fiber daily target (deficit-bumped) and ceiling. */
const FIBER_TARGET_G = 30;
const FIBER_CEILING_G = 60;
/** Protein g/kg research anchors (Schoenfeld 2018, Helms et al). */
const PROTEIN_G_PER_KG_TIERS = [1.6, 1.8, 2.0, 2.2] as const;
/** Fat g/kg tiers (FAT_HARD_FLOOR / FAT_SOFT_FLOOR / FAT_MAINTENANCE_TARGET). */
const FAT_G_PER_KG_TIERS = [0.6, 0.8, 1.0] as const;

interface Goalpost {
  value: number;
  label: string;
  /** 'achievement' (default): just a tier mark, no overlay past it.
   *  'softCeiling': render orange overlay past this value (warning, not stop).
   *  'hardCeiling': render red overlay past this value (real ceiling — stop). */
  kind?: "achievement" | "softCeiling" | "hardCeiling";
}

export function ComposeMealView({
  portions: initialPortions,
  ingredients,
  budget,
  dayTargets,
  dayConsumed,
  weightKg,
  totalBurn,
  onLog,
  onCancel,
  onEditIngredients,
  logging = false,
  onTotalsChange,
}: ComposeMealViewProps) {
  const [portions, setPortions] = useState(initialPortions);
  const [maxYolks, setMaxYolks] = useState(1);
  // Track which ingredients are in "cooked" display mode (key = ingredient_id)
  const [cookedMode, setCookedMode] = useState<Set<string>>(new Set());
  const [gramMode, setGramMode] = useState<Set<string>>(new Set());

  const ingMap = useMemo(() => {
    const m = new Map<string, Ingredient>();
    for (const i of ingredients) m.set(i.id, i);
    return m;
  }, [ingredients]);

  const toggleCookedMode = (ingredientId: string) => {
    setCookedMode((prev) => {
      const next = new Set(prev);
      if (next.has(ingredientId)) next.delete(ingredientId);
      else next.add(ingredientId);
      return next;
    });
  };

  /** Set absolute display-unit grams for an ingredient (handles cooked→raw conversion). */
  const handlePortionChange = (ingredientId: string, displayGrams: number) => {
    const ing = ingMap.get(ingredientId);
    const isCooked = cookedMode.has(ingredientId);

    setPortions((prev) =>
      prev.map((p) => {
        if (p.ingredient_id !== ingredientId) return p;
        let newRawGrams: number;
        if (isCooked && ing && hasRawCookedToggle(ing)) {
          newRawGrams = cookedToRaw(ing, Math.max(0, displayGrams));
        } else {
          newRawGrams = Math.max(0, displayGrams);
        }
        if (!ing) return { ...p, grams: newRawGrams };
        const macros = computeItemMacros(ing, newRawGrams);
        return { ...p, grams: newRawGrams, ...macros };
      }),
    );
  };

  const totals = useMemo(() => sumPortionMacros(portions), [portions]);

  // Emit totals to parent for live budget preview
  const onTotalsRef = useRef(onTotalsChange);
  onTotalsRef.current = onTotalsChange;
  useEffect(() => {
    onTotalsRef.current?.(totals);
  }, [totals]);

  // Clamp whole egg grams when maxYolks changes
  useEffect(() => {
    const wholeEgg = portions.find(p => p.ingredient_id === "eggs_whole");
    if (wholeEgg) {
      const ing = ingMap.get("eggs_whole");
      const maxGrams = (ing?.grams_per_unit || 50) * maxYolks;
      if (wholeEgg.grams > maxGrams) {
        handlePortionChange("eggs_whole", maxGrams);
      }
    }
  }, [maxYolks]);

  const totalGrams = useMemo(() => portions.reduce((s, p) => s + p.grams, 0), [portions]);
  const volumeScore = totals.calories > 0 ? totalGrams / totals.calories : 0;

  const handleLog = () => {
    const items = portions.map((p) => ({
      ingredient_id: p.ingredient_id, grams: p.grams,
      calories: p.calories, protein: p.protein, carbs: p.carbs, fat: p.fat, fiber: p.fiber,
    }));
    onLog(items, totals);
  };

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Composed Meal</span>
          {onEditIngredients && (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 text-[10px] px-1.5 text-muted-foreground"
              onClick={onEditIngredients}
            >
              ± ingredients
            </Button>
          )}
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onCancel}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="space-y-1.5">
        {[...portions].sort((a, b) => {
          const order: Record<string, number> = { vegetable: 0, protein: 1, carbs: 2, fruit: 3, dairy: 4, fat: 5, sauce: 6, supplement: 7 };
          const catA = ingMap.get(a.ingredient_id)?.category ?? "zzz";
          const catB = ingMap.get(b.ingredient_id)?.category ?? "zzz";
          return (order[catA] ?? 99) - (order[catB] ?? 99);
        }).map((p) => {
          const ing = ingMap.get(p.ingredient_id);
          const canToggle = ing && hasRawCookedToggle(ing);
          const isCooked = cookedMode.has(p.ingredient_id);
          const displayGrams = isCooked && ing ? rawToCooked(ing, p.grams) : p.grams;
          return (
            <div key={p.ingredient_id} className="text-sm">
              <div className="flex items-center justify-between gap-2">
                <button
                  onClick={() => setPortions(prev => prev.filter(pp => pp.ingredient_id !== p.ingredient_id))}
                  className="text-muted-foreground/30 hover:text-rose-500 shrink-0"
                  title="Remove ingredient"
                >
                  <X className="h-3 w-3" />
                </button>
                <span className="truncate flex-1 min-w-0">
                  {ing?.name ?? p.ingredient_id}
                  <span className="block text-[10px] text-muted-foreground">
                    {p.calories}kcal · {p.protein}P · {p.carbs}C · {p.fat}F
                  </span>
                </span>
                {ing && isCountBased(ing) && !gramMode.has(p.ingredient_id) ? (
                  <NumberInput
                    value={gramsToCount(ing, p.grams)}
                    onChange={(v) => handlePortionChange(p.ingredient_id, countToGrams(ing, v))}
                    min={0}
                    max={20}
                    step={ing.unit_step ?? 0.25}
                    suffix={ing.unit || "pcs"}
                    className="w-36 shrink-0"
                  />
                ) : (
                  <NumberInput
                    value={Math.round(displayGrams)}
                    onChange={(v) => handlePortionChange(p.ingredient_id, v)}
                    min={0}
                    max={500}
                    step={p.increment}
                    sliderStep={1}
                    suffix="g"
                    className="w-36 shrink-0"
                  />
                )}
              </div>
              <div className="flex gap-2">
                {canToggle && (
                  <button
                    className="text-[10px] text-muted-foreground ml-0.5 hover:text-foreground"
                    onClick={() => toggleCookedMode(p.ingredient_id)}
                  >
                    {isCooked ? `cooked (${p.grams}g raw)` : "switch to cooked weight"}
                  </button>
                )}
                {ing && isCountBased(ing) && (
                  <button
                    className="text-[10px] text-muted-foreground ml-0.5 hover:text-foreground"
                    onClick={() => setGramMode((prev) => {
                      const next = new Set(prev);
                      next.has(p.ingredient_id) ? next.delete(p.ingredient_id) : next.add(p.ingredient_id);
                      return next;
                    })}
                  >
                    {gramMode.has(p.ingredient_id) ? `switch to ${ing.unit || "pcs"}` : "switch to grams"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Max yolks config */}
      {portions.some(p => p.ingredient_id === "eggs_whole") && (
        <div className="flex items-center justify-between text-xs bg-muted/50 rounded-md px-3 py-2">
          <span className="text-muted-foreground">Max yolks per day</span>
          <div className="flex items-center gap-2">
            {[1, 2, 3].map(n => (
              <button
                key={n}
                onClick={() => setMaxYolks(n)}
                className={`w-7 h-7 rounded-md text-xs font-medium ${maxYolks === n ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80"}`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Per-meal read-out — day-progress shape with multi-goalpost references.
          Each bar shows:
          - DARKER segment: macros eaten today before this meal (excludes the
            meal being edited so we don't double-count).
          - LIGHTER segment: this meal's preview, stacked on top.
          - RED segment: portion that pushes the day total past the HIGHEST
            goalpost (e.g. 2.2 g/kg for protein, fiber ceiling 60g, total burn
            for kcal — eating past these is "meaningfully over").
          - Multi-goalpost markers: thin vertical ticks at research-anchored
            values (4 for protein at 1.6/1.8/2.0/2.2 g/kg, 3 for fat at
            0.6/0.8/1.0 g/kg, 2 for carbs at 100g floor + today's target,
            2 for fiber at 30g target / 60g ceiling, 2 for kcal at target +
            total burn). Crossed (eaten + this meal ≥ marker) → dim. Ahead
            → bright. NEVER hidden by fill. */}
      {(() => {
        const w = weightKg && weightKg > 0 ? weightKg : 0;
        const dayKcalTarget = dayTargets?.calories ?? 0;
        const burn = totalBurn && totalBurn > 0 ? totalBurn : 0;

        // Goalpost taxonomy:
        //  - kcal: target is a SOFT ceiling (orange — over goal but in deficit
        //    is fine), burn is the HARD ceiling (red — surplus = stop).
        //  - Protein/Carbs/Fat: only achievement tiers. No real upper ceiling
        //    on any of these — eating past them is just "above the highest
        //    research anchor", not wrong. No orange/red overlay.
        //  - Fiber: 60g is the HARD ceiling (real GI distress threshold).
        const goalposts: Record<"kcal" | "P" | "C" | "F" | "Fi", Goalpost[]> = {
          kcal: [
            ...(dayKcalTarget > 0 ? [{ value: dayKcalTarget, label: "goal", kind: "softCeiling" as const }] : []),
            ...(burn > 0 ? [{ value: burn, label: "burn", kind: "hardCeiling" as const }] : []),
          ],
          P: w > 0
            ? PROTEIN_G_PER_KG_TIERS.map((g) => ({ value: w * g, label: g.toFixed(1) }))
            : (dayTargets?.protein ? [{ value: dayTargets.protein, label: "target" }] : []),
          C: dayTargets?.carbs
            ? [
                { value: CARB_HEALTH_FLOOR_G, label: "min" },
                { value: dayTargets.carbs, label: "target" },
              ].sort((a, b) => a.value - b.value)
            : [{ value: CARB_HEALTH_FLOOR_G, label: "min" }],
          F: w > 0
            ? FAT_G_PER_KG_TIERS.map((g) => ({ value: w * g, label: g.toFixed(1) }))
            : (dayTargets?.fat ? [{ value: dayTargets.fat, label: "target" }] : []),
          Fi: [
            { value: FIBER_TARGET_G, label: "target" },
            { value: FIBER_CEILING_G, label: "ceil", kind: "hardCeiling" },
          ],
        };

        type Key = "kcal" | "P" | "C" | "F" | "Fi";
        const colorMap: Record<Key, { eaten: string; thisMeal: string; text: string }> = {
          kcal: { eaten: "bg-primary/60", thisMeal: "bg-primary",     text: "text-foreground" },
          P:    { eaten: "bg-blue-700",   thisMeal: "bg-blue-500",    text: "text-blue-400" },
          C:    { eaten: "bg-amber-700",  thisMeal: "bg-amber-500",   text: "text-amber-400" },
          F:    { eaten: "bg-rose-700",   thisMeal: "bg-rose-500",    text: "text-rose-400" },
          Fi:   { eaten: "bg-green-700",  thisMeal: "bg-green-500",   text: "text-green-400" },
        };

        const data: Record<Key, { eaten: number; thisMeal: number; suffix: string; extra?: React.ReactNode }> = {
          kcal: { eaten: dayConsumed?.calories ?? 0, thisMeal: totals.calories, suffix: "" },
          P:    { eaten: dayConsumed?.protein ?? 0,  thisMeal: totals.protein,  suffix: "g", extra: <ProteinQualityPill grams={totals.protein} /> },
          C:    { eaten: dayConsumed?.carbs ?? 0,    thisMeal: totals.carbs,    suffix: "g" },
          F:    { eaten: dayConsumed?.fat ?? 0,      thisMeal: totals.fat,      suffix: "g" },
          Fi:   { eaten: dayConsumed?.fiber ?? 0,    thisMeal: totals.fiber,    suffix: "g" },
        };

        const renderBar = (key: Key) => {
          const { eaten, thisMeal, suffix, extra } = data[key];
          const { eaten: eatenColor, thisMeal: liveColor, text: textColor } = colorMap[key];
          const posts = goalposts[key];
          const total = eaten + thisMeal;
          const highestPost = posts.length > 0 ? Math.max(...posts.map((g) => g.value)) : 0;
          const softCeiling = posts.find((p) => p.kind === "softCeiling");
          const hardCeiling = posts.find((p) => p.kind === "hardCeiling");

          // Display denominator: prefer soft ceiling if exists (kcal goal),
          // else hard ceiling (fiber 60g), else the highest achievement tier.
          const displayRef = softCeiling?.value ?? hardCeiling?.value ?? highestPost;

          // barMax: enough headroom for highest goalpost + ~5% past total when over.
          const barMax = Math.max(highestPost * 1.15, total * 1.05, 1);

          const eatenPct = Math.min(100, (eaten / barMax) * 100);
          const totalPct = Math.min(100, (total / barMax) * 100);

          const pastSoft = !!softCeiling && total > softCeiling.value;
          const pastHard = !!hardCeiling && total > hardCeiling.value;
          // Orange runs from softCeiling to min(total, hardCeiling).
          // Red runs from hardCeiling to total.
          const softStartPct = softCeiling ? Math.min(100, (softCeiling.value / barMax) * 100) : 0;
          const orangeEndValue = hardCeiling ? Math.min(total, hardCeiling.value) : total;
          const orangeEndPct = Math.min(100, (orangeEndValue / barMax) * 100);
          const hardStartPct = hardCeiling ? Math.min(100, (hardCeiling.value / barMax) * 100) : 100;

          return (
            <div key={key} className="flex items-center gap-2 text-xs">
              <span className="w-8 text-muted-foreground text-right">{key}</span>
              <div className="relative flex-1 h-2 bg-muted rounded-full overflow-hidden">
                {/* Section 1: eaten today before this meal — DARKER shade. */}
                {eatenPct > 0 && (
                  <div className={`absolute left-0 top-0 h-full ${eatenColor}`}
                    style={{ width: `${eatenPct}%` }} />
                )}
                {/* Section 2: this meal — NORMAL/lighter shade, stacked on top. */}
                {totalPct > eatenPct && (
                  <div className={`absolute top-0 h-full ${liveColor}`}
                    style={{ left: `${eatenPct}%`, width: `${totalPct - eatenPct}%` }} />
                )}
                {/* Soft-ceiling overlay (orange) — only when this macro has a
                    soft ceiling and total has crossed it. Stops at the hard
                    ceiling (or total if no hard ceiling). */}
                {pastSoft && orangeEndPct > softStartPct && (
                  <div className="absolute top-0 h-full bg-amber-500"
                    style={{ left: `${softStartPct}%`, width: `${orangeEndPct - softStartPct}%` }} />
                )}
                {/* Hard-ceiling overlay (red) — only when this macro has a
                    hard ceiling and total has crossed it. */}
                {pastHard && (
                  <div className="absolute top-0 h-full bg-red-500"
                    style={{ left: `${hardStartPct}%`, width: `${totalPct - hardStartPct}%` }} />
                )}
                {/* Goalpost markers. Always opaque so fill can't hide them.
                    Crossed = dim (foreground/40), ahead = bright (foreground). */}
                {posts.map((g, i) => {
                  const pct = Math.min(100, (g.value / barMax) * 100);
                  const crossed = total >= g.value;
                  return (
                    <div
                      key={i}
                      className={`absolute top-0 h-full w-[2px] ${crossed ? "bg-foreground/40" : "bg-foreground"}`}
                      style={{ left: `${pct}%` }}
                      title={`${g.label}: ${Math.round(g.value)}${suffix}`}
                    />
                  );
                })}
              </div>
              <span className="w-24 text-right tabular-nums text-muted-foreground">
                <span className={`${textColor} font-medium`}>{Math.round(thisMeal)}{suffix}</span>
                {extra}
                <span className="block text-[10px] text-muted-foreground/60">
                  <span className={pastHard ? "text-red-500" : pastSoft ? "text-amber-500" : ""}>
                    {Math.round(total)}
                  </span>
                  {displayRef > 0 && <> / {Math.round(displayRef)}</>} day
                </span>
              </span>
            </div>
          );
        };

        return (
          <div className="space-y-1.5 border-t pt-2">
            {(["kcal", "P", "C", "F", "Fi"] as const).map(renderBar)}
          </div>
        );
      })()}

      {/* Volume score */}
      {totals.calories > 0 && (
        <div className={`text-xs text-center ${
          volumeScore >= 1.5 ? "text-green-600" : volumeScore >= 0.8 ? "text-muted-foreground" : "text-amber-600"
        }`}>
          {volumeScore >= 1.5 ? "High volume \u2014 great for satiety"
           : volumeScore >= 0.8 ? `${totalGrams}g total`
           : `${totalGrams}g total \u2014 low volume`}
        </div>
      )}

      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="flex-1" onClick={onCancel}>Cancel</Button>
        <Button size="sm" className="flex-1" onClick={handleLog}
          disabled={logging || portions.every((p) => p.grams === 0)}>
          {logging ? "Logging..." : "Log"}
        </Button>
      </div>
    </div>
  );
}
