import { useMemo, useState } from "react";
import { View, Pressable } from "react-native";
import { Text, Card } from "soma-style";
import type { SomaMeal, Ingredient } from "../lib/api";

const SLOT_LABELS: Record<string, string> = {
  breakfast: "bfast",
  lunch: "lunch",
  dinner: "dinner",
  pre_sleep: "presleep",
  during_workout: "workout",
};

interface PrepItem {
  id: string;
  name: string;
  totalGrams: number;
  meals: { slot: string; grams: number }[];
}

/**
 * The day's prep list (web nutrition prep-summary parity): groups the day's
 * meal items by ingredient, keeps only cookable (`is_raw`) ones, sums grams and
 * lists the per-slot split. Collapsible; hides itself when nothing needs cooking.
 */
export function PrepSummary({ meals, ingredients }: { meals: SomaMeal[]; ingredients: Ingredient[] }) {
  const [expanded, setExpanded] = useState(false);

  const prepItems = useMemo<PrepItem[]>(() => {
    const ingLookup = new Map(ingredients.map((i) => [i.id, i]));
    const groups: Record<string, { name: string; isRaw: boolean; meals: { slot: string; grams: number }[] }> = {};

    for (const meal of meals) {
      for (const item of meal.items ?? []) {
        const id = item.ingredient_id;
        if (!id) continue;
        const grams = Number(item.grams) || 0;
        if (grams <= 0) continue;
        if (!groups[id]) {
          const ing = ingLookup.get(id);
          const name = ing?.name || (item.name || id)
            .replace(/_raw$/, "")
            .replace(/_(dry|whole)$/i, "")
            .replace(/_\d+pct$/i, "")
            .replace(/_/g, " ")
            .replace(/\b\w/g, (c) => c.toUpperCase())
            .trim();
          groups[id] = { name, isRaw: !!ing?.is_raw, meals: [] };
        }
        groups[id].meals.push({ slot: meal.meal_slot, grams });
      }
    }

    return Object.entries(groups)
      .filter(([, g]) => g.isRaw)
      .map(([id, g]): PrepItem => ({
        id,
        name: g.name,
        totalGrams: g.meals.reduce((s, m) => s + m.grams, 0),
        meals: g.meals,
      }))
      .sort((a, b) => b.totalGrams - a.totalGrams);
  }, [meals, ingredients]);

  if (prepItems.length === 0) return null;

  return (
    <Card className="gap-2">
      <Pressable onPress={() => setExpanded((e) => !e)} hitSlop={6}>
        <View className="flex-row items-center justify-between">
          <Text variant="eyebrow">Prep list · {prepItems.length} to cook</Text>
          <Text variant="micro" className="text-text-muted">{expanded ? "▲" : "▼"}</Text>
        </View>
      </Pressable>
      {expanded ? (
        <View className="gap-1.5">
          {prepItems.map((item) => (
            <View key={item.id} className="flex-row items-baseline justify-between gap-2">
              <Text variant="caption" className="flex-shrink text-text">{item.name}</Text>
              <View className="flex-row items-baseline gap-1.5">
                <Text variant="caption" className="text-text tabular-nums">{Math.round(item.totalGrams)}g</Text>
                <Text variant="micro" className="text-text-muted">
                  ({item.meals.map((m) => `${Math.round(m.grams)}g ${SLOT_LABELS[m.slot] ?? m.slot}`).join(" + ")})
                </Text>
              </View>
            </View>
          ))}
          <Text variant="micro" className="text-text-muted">Raw weights to cook, grouped across the day.</Text>
        </View>
      ) : null}
    </Card>
  );
}
