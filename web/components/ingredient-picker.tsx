"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Ingredient } from "@/lib/portion-solver";

const CATEGORY_ORDER = ["protein", "carbs", "vegetable", "fat", "dairy", "fruit", "sauce", "supplement"];

const CATEGORY_LABELS: Record<string, string> = {
  protein: "Protein", carbs: "Carbs", vegetable: "Vegetable", fat: "Fat",
  dairy: "Dairy", fruit: "Fruit", sauce: "Sauce", supplement: "Supplement",
};

interface IngredientPickerProps {
  ingredients: Ingredient[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onDone: () => void;
  onCancel: () => void;
}

export function IngredientPicker({ ingredients, selected, onToggle, onDone, onCancel }: IngredientPickerProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Group ingredients by category
  const grouped = new Map<string, Ingredient[]>();
  for (const ing of ingredients) {
    const cat = ing.category;
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(ing);
  }

  const toggleCategory = (cat: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          Pick ingredients ({selected.size} selected)
        </span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onCancel}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {CATEGORY_ORDER.filter((cat) => grouped.has(cat)).map((cat) => (
        <div key={cat}>
          <button
            className="flex items-center gap-1 text-xs font-medium text-muted-foreground mb-1.5"
            onClick={() => toggleCategory(cat)}
          >
            {collapsed.has(cat) ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
            {CATEGORY_LABELS[cat] ?? cat}
          </button>
          {!collapsed.has(cat) && (
            <div className="flex flex-wrap gap-1.5">
              {grouped.get(cat)!.map((ing) => (
                <Button
                  key={ing.id}
                  variant={selected.has(ing.id) ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => onToggle(ing.id)}
                >
                  {ing.name}
                </Button>
              ))}
            </div>
          )}
        </div>
      ))}

      {selected.size > 0 && (
        <Button size="sm" className="w-full" onClick={onDone}>
          Size portions ({selected.size} ingredients)
        </Button>
      )}
    </div>
  );
}
