"use client";

import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Ingredient } from "@/lib/portion-solver";

interface MealItem {
  ingredient_id?: string;
  grams?: number;
  cooked_grams?: number;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
}

interface MealDetailModalProps {
  open: boolean;
  onClose: () => void;
  meal: {
    preset_name: string | null;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    fiber: number;
    items: any;
    portion_multiplier: number;
  } | null;
  ingredients: Ingredient[];
  onEdit?: () => void;
}

export function MealDetailModal({ open, onClose, meal, ingredients, onEdit }: MealDetailModalProps) {
  if (!meal) return null;

  const ingMap = new Map(ingredients.map((i) => [i.id, i]));
  const itemsList: MealItem[] = Array.isArray(meal.items) ? meal.items : (meal.items?.items ?? []);

  // Sort: veggies first
  const order: Record<string, number> = { vegetable: 0, protein: 1, carbs: 2, fruit: 3, dairy: 4, fat: 5, sauce: 6, supplement: 7 };
  const sortedItems = [...itemsList].sort((a, b) => {
    const catA = ingMap.get(a.ingredient_id ?? "")?.category ?? "zzz";
    const catB = ingMap.get(b.ingredient_id ?? "")?.category ?? "zzz";
    return (order[catA] ?? 99) - (order[catB] ?? 99);
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {meal.preset_name || "Custom meal"}
            {meal.portion_multiplier !== 1 && ` (${meal.portion_multiplier}x)`}
          </DialogTitle>
        </DialogHeader>

        {/* Total macros */}
        <div className="grid grid-cols-5 gap-2 text-center text-xs border-b pb-2">
          <div><div className="font-bold tabular-nums">{Math.round(meal.calories)}</div><div className="text-muted-foreground text-[10px]">kcal</div></div>
          <div><div className="font-bold tabular-nums text-blue-500">{Math.round(meal.protein)}g</div><div className="text-muted-foreground text-[10px]">protein</div></div>
          <div><div className="font-bold tabular-nums text-amber-500">{Math.round(meal.carbs)}g</div><div className="text-muted-foreground text-[10px]">carbs</div></div>
          <div><div className="font-bold tabular-nums text-rose-500">{Math.round(meal.fat)}g</div><div className="text-muted-foreground text-[10px]">fat</div></div>
          <div><div className="font-bold tabular-nums text-green-500">{Math.round(meal.fiber)}g</div><div className="text-muted-foreground text-[10px]">fiber</div></div>
        </div>

        {/* Per-ingredient breakdown */}
        {sortedItems.length > 0 && (
          <div className="space-y-2">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Ingredients</div>
            <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto_auto] gap-x-2 gap-y-1 text-xs">
              <span className="text-[10px] text-muted-foreground">Name</span>
              <span className="text-[10px] text-muted-foreground text-right">g</span>
              <span className="text-[10px] text-muted-foreground text-right">cal</span>
              <span className="text-[10px] text-muted-foreground text-right">P</span>
              <span className="text-[10px] text-muted-foreground text-right">C</span>
              <span className="text-[10px] text-muted-foreground text-right">F</span>
              <span className="text-[10px] text-muted-foreground text-right">Fi</span>
              {sortedItems.map((item, idx) => {
                const ing = ingMap.get(item.ingredient_id ?? "");
                const name = ing?.name ?? item.ingredient_id ?? "?";
                const rawG = item.grams ?? 0;
                const ratio = ing?.raw_to_cooked_ratio;
                const isRaw = ing?.is_raw && ratio && ratio > 0 && ratio !== 1;
                const cookedG = item.cooked_grams ?? (isRaw ? Math.round(rawG * (ratio as number)) : 0);
                // Per-ingredient macros
                const cal = item.calories ?? (rawG * (ing?.calories_per_100g ?? 0) / 100);
                const p = item.protein ?? (rawG * (ing?.protein_per_100g ?? 0) / 100);
                const c = item.carbs ?? (rawG * (ing?.carbs_per_100g ?? 0) / 100);
                const f = item.fat ?? (rawG * (ing?.fat_per_100g ?? 0) / 100);
                const fi = item.fiber ?? (rawG * (ing?.fiber_per_100g ?? 0) / 100);
                return (
                  <React.Fragment key={idx}>
                    <span className="truncate">
                      {name}
                      {isRaw && <span className="text-[9px] text-muted-foreground ml-0.5">{cookedG}g cooked</span>}
                    </span>
                    <span className="tabular-nums text-right">{rawG}g</span>
                    <span className="tabular-nums text-right">{Math.round(cal)}</span>
                    <span className="tabular-nums text-right text-blue-500">{Math.round(p)}</span>
                    <span className="tabular-nums text-right text-amber-500">{Math.round(c)}</span>
                    <span className="tabular-nums text-right text-rose-500">{Math.round(f)}</span>
                    <span className="tabular-nums text-right text-green-500">{Math.round(fi)}</span>
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        )}

        {/* Edit button */}
        {onEdit && (
          <button
            className="w-full text-xs text-muted-foreground hover:text-foreground text-center py-1"
            onClick={() => { onClose(); onEdit(); }}
          >
            Edit this meal
          </button>
        )}
      </DialogContent>
    </Dialog>
  );
}
