"use client";

import { useState, useMemo } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/number-input";
import {
  type Ingredient,
  type PortionResult,
  computeItemMacros,
  sumPortionMacros,
  rawToCooked,
  cookedToRaw,
  hasRawCookedToggle,
} from "@/lib/portion-solver";

interface ComposeMealViewProps {
  portions: PortionResult[];
  ingredients: Ingredient[];
  budget: Record<string, number> | null;
  onLog: (
    items: { ingredient_id: string; grams: number; calories: number; protein: number; carbs: number; fat: number; fiber: number }[],
    totals: { calories: number; protein: number; carbs: number; fat: number; fiber: number },
  ) => void;
  onCancel: () => void;
  onEditIngredients?: () => void;
  logging?: boolean;
}

export function ComposeMealView({
  portions: initialPortions,
  ingredients,
  budget,
  onLog,
  onCancel,
  onEditIngredients,
  logging = false,
}: ComposeMealViewProps) {
  const [portions, setPortions] = useState(initialPortions);
  // Track which ingredients are in "cooked" display mode (key = ingredient_id)
  const [cookedMode, setCookedMode] = useState<Set<string>>(new Set());

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
  const fitsBudget = budget != null && totals.calories <= (budget.calories ?? Infinity) * 1.05;
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
                <span className="truncate flex-1 min-w-0">{ing?.name ?? p.ingredient_id}</span>
                <NumberInput
                  value={Math.round(displayGrams)}
                  onChange={(v) => handlePortionChange(p.ingredient_id, v)}
                  min={0}
                  max={500}
                  step={p.increment}
                  suffix="g"
                  className="w-36 shrink-0"
                />
              </div>
              {canToggle && (
                <button
                  className="text-[10px] text-muted-foreground ml-0.5 hover:text-foreground"
                  onClick={() => toggleCookedMode(p.ingredient_id)}
                >
                  {isCooked ? `cooked (${p.grams}g raw)` : "switch to cooked weight"}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-4 gap-2 text-center text-xs border-t pt-2">
        <div><div className="font-bold tabular-nums">{totals.calories}</div><div className="text-muted-foreground">kcal</div></div>
        <div><div className="font-bold tabular-nums text-blue-500">{totals.protein}g</div><div className="text-muted-foreground">protein</div></div>
        <div><div className="font-bold tabular-nums text-amber-500">{totals.carbs}g</div><div className="text-muted-foreground">carbs</div></div>
        <div><div className="font-bold tabular-nums text-rose-500">{totals.fat}g</div><div className="text-muted-foreground">fat</div></div>
      </div>

      {budget && (
        <div className={`text-xs text-center ${fitsBudget ? "text-green-600" : "text-amber-600"}`}>
          {fitsBudget ? "Fits slot budget" : `${totals.calories - Math.round(budget.calories)} kcal over budget`}
        </div>
      )}

      {/* Volume score */}
      {totals.calories > 0 && (
        <div className={`text-xs text-center ${
          volumeScore >= 1.5 ? "text-green-600" : volumeScore >= 0.8 ? "text-muted-foreground" : "text-amber-600"
        }`}>
          {volumeScore >= 1.5 ? "High volume meal \u2014 great for satiety"
           : volumeScore >= 0.8 ? `${totalGrams}g total \u2014 moderate volume`
           : "Low volume \u2014 consider adding vegetables for fullness"}
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
