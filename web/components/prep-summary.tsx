"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface Meal {
  meal_slot: string;
  items: any[];
}

interface PrepItem {
  ingredientId: string;
  name: string;
  totalGrams: number;
  isRaw: boolean;
  meals: { slot: string; grams: number }[];
}

const SLOT_LABELS: Record<string, string> = {
  breakfast: "bfast",
  lunch: "lunch",
  dinner: "dinner",
  pre_sleep: "presleep",
  during_workout: "workout",
};

export function PrepSummary({ meals, desktop }: { meals: Meal[]; desktop?: boolean }) {
  const [expanded, setExpanded] = useState(false);

  const prepItems = useMemo(() => {
    // Group items by ingredient_id across all meals
    const groups: Record<string, { name: string; isRaw: boolean; meals: { slot: string; grams: number }[] }> = {};

    for (const meal of meals) {
      if (!meal.items) continue;
      for (const item of meal.items) {
        const id = item.ingredient_id;
        if (!id) continue;
        // Use raw grams (the actual grams field is always raw weight)
        const grams = Number(item.grams) || 0;
        if (grams <= 0) continue;

        if (!groups[id]) {
          // Prettify name from ingredient_id
          const name = (item.name || id)
            .replace(/_raw$/, "")
            .replace(/_(dry|whole)$/i, "")
            .replace(/_\d+pct$/i, "")
            .replace(/_/g, " ")
            .replace(/\b\w/g, (c: string) => c.toUpperCase())
            .trim();
          groups[id] = { name, isRaw: !!item.is_raw, meals: [] };
        }
        groups[id].meals.push({ slot: meal.meal_slot, grams });
      }
    }

    // Filter to ingredients in 2+ DIFFERENT meals
    return Object.entries(groups)
      .filter(([, g]) => g.meals.length >= 2)
      .map(([id, g]): PrepItem => ({
        ingredientId: id,
        name: g.name,
        totalGrams: g.meals.reduce((s, m) => s + m.grams, 0),
        isRaw: g.isRaw,
        meals: g.meals,
      }))
      .sort((a, b) => b.totalGrams - a.totalGrams);
  }, [meals]);

  if (prepItems.length === 0) return null;

  const content = (
    <div className="space-y-1.5">
      {prepItems.map((item) => (
        <div key={item.ingredientId} className="flex items-baseline justify-between text-xs">
          <span className="font-medium">{item.name}</span>
          <div className="text-right">
            <span className="tabular-nums font-medium">{item.totalGrams}g</span>
            {item.isRaw && <span className="text-muted-foreground ml-1">raw</span>}
            <span className="text-muted-foreground text-[10px] ml-1.5">
              ({item.meals.map((m) => `${m.grams}g ${SLOT_LABELS[m.slot] || m.slot}`).join(" + ")})
            </span>
          </div>
        </div>
      ))}
    </div>
  );

  // Desktop: always visible card
  if (desktop) {
    return (
      <Card>
        <CardContent className="py-3">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Prep List</div>
          {content}
        </CardContent>
      </Card>
    );
  }

  // Mobile: collapsible
  return (
    <button
      onClick={() => setExpanded(!expanded)}
      className="w-full text-left"
    >
      <div className="flex items-center justify-between text-xs text-muted-foreground py-2">
        <span className="font-medium">Prep list ({prepItems.length} items)</span>
        {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </div>
      {expanded && (
        <Card className="mb-2">
          <CardContent className="py-3">
            {content}
          </CardContent>
        </Card>
      )}
    </button>
  );
}
