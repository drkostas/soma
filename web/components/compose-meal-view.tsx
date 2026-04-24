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

interface ComposeMealViewProps {
  portions: PortionResult[];
  ingredients: Ingredient[];
  budget: SlotBudget | null;
  onLog: (
    items: { ingredient_id: string; grams: number; calories: number; protein: number; carbs: number; fat: number; fiber: number }[],
    totals: { calories: number; protein: number; carbs: number; fat: number; fiber: number },
  ) => void;
  onCancel: () => void;
  onEditIngredients?: () => void;
  logging?: boolean;
  onTotalsChange?: (totals: { calories: number; protein: number; carbs: number; fat: number; fiber: number }) => void;
}

export function ComposeMealView({
  portions: initialPortions,
  ingredients,
  budget,
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

      {/* Per-meal read-out — kcal is a soft pacing bar; P/C/F/Fi are plain
          numbers. Per-meal P/C/F/Fi do NOT have scientific caps (Schoenfeld &
          Aragon 2018; Trommelen 2023), so we don't draw goal markers or flip
          to an "over" state for them. Protein gets an MPS-quality pill. */}
      <div className="space-y-1.5 border-t pt-2">
        {(() => {
          const kcalBudget = budget?.calories || 0;
          const barMax = Math.max(kcalBudget * 1.3, totals.calories * 1.05, kcalBudget + 1);
          const fillPct = barMax > 0 ? Math.min(100, (totals.calories / barMax) * 100) : 0;
          const goalPct = barMax > 0 && kcalBudget > 0 ? Math.min(100, (kcalBudget / barMax) * 100) : 0;
          return (
            <div className="flex items-center gap-2 text-xs">
              <span className="w-8 text-muted-foreground text-right">kcal</span>
              <div
                className="relative flex-1 h-2 bg-muted rounded-full overflow-hidden"
                title="Per-meal kcal is a soft pacing hint — splits the daily target across slots. Going over here is fine as long as the day total lands right."
              >
                {kcalBudget > 0 && (
                  <div className="absolute right-0 top-0 h-full bg-muted-foreground/10" style={{ width: `${100 - goalPct}%` }} />
                )}
                <div
                  className="absolute left-0 top-0 h-full rounded-full transition-all bg-primary"
                  style={{ width: `${fillPct}%` }}
                />
                {kcalBudget > 0 && (
                  <div className="absolute top-0 h-full w-[2px] bg-foreground/40" style={{ left: `${goalPct}%` }} />
                )}
              </div>
              <span className="w-24 text-right tabular-nums text-muted-foreground">
                {Math.round(totals.calories)}
                {kcalBudget > 0 && <span className="text-muted-foreground/60"> / {Math.round(kcalBudget)} budget</span>}
              </span>
            </div>
          );
        })()}

        <div className="flex items-center gap-3 text-xs text-muted-foreground pt-0.5">
          <span className="flex items-center tabular-nums">
            <span className="text-blue-400 font-medium">{Math.round(totals.protein)}g</span>
            <span className="ml-1 text-muted-foreground/70">P</span>
            <ProteinQualityPill grams={totals.protein} />
          </span>
          <span className="tabular-nums"><span className="text-amber-400 font-medium">{Math.round(totals.carbs)}g</span> <span className="text-muted-foreground/70">C</span></span>
          <span className="tabular-nums"><span className="text-rose-400 font-medium">{Math.round(totals.fat)}g</span> <span className="text-muted-foreground/70">F</span></span>
          <span className="tabular-nums"><span className="text-green-400 font-medium">{Math.round(totals.fiber)}g</span> <span className="text-muted-foreground/70">Fi</span></span>
        </div>
      </div>

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
