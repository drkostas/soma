import { useState, useMemo, useEffect } from "react";
import { View, ScrollView, TextInput, Pressable } from "react-native";
import { Text, Button } from "soma-style";
import { ingredientMacros, logComposedMeal, deleteMeal, type Ingredient } from "../lib/api";

const CATEGORY_LABELS: Record<string, string> = {
  protein: "Protein", carbs: "Carbs", grain: "Grain", vegetable: "Vegetable", fat: "Fat",
  dairy: "Dairy", fruit: "Fruit", sauce: "Sauce", supplement: "Supplement",
};
const CATEGORY_ORDER = ["protein", "carbs", "grain", "vegetable", "fat", "dairy", "fruit", "sauce", "supplement"];

/** Compose a meal from raw ingredients: search + category-grouped picker,
 *  per-ingredient gram editors with live macros, running totals, and log.
 *  Mobile-adapted from the web ComposeMealView (grams-based; the raw/cooked
 *  and count editors + save-as-preset stay a web-only power feature for now). */
export function ComposeMealView({
  ingredients, date, slot, onLogged, initialGrams, editMealId, onTotalsChange,
}: {
  ingredients: Ingredient[]; date: string; slot: string; onLogged: () => void;
  /** Pre-select ingredients (id -> grams) — used when editing a logged meal. */
  initialGrams?: Record<string, number>;
  /** When set, saving deletes this meal after re-logging (edit = replace). */
  editMealId?: number | null;
  /** Emits the in-progress meal totals on every change, so the screen can fold
   *  them into the day's live preview (remaining kcal + macro bars). */
  onTotalsChange?: (t: { calories: number; protein: number; carbs: number; fat: number; fiber: number }) => void;
}) {
  const [search, setSearch] = useState("");
  const [grams, setGrams] = useState<Record<string, number>>(initialGrams ?? {});
  const [busy, setBusy] = useState(false);
  const initKey = initialGrams ? Object.entries(initialGrams).map(([k, v]) => `${k}:${v}`).join(",") : "";
  useEffect(() => { if (initialGrams) setGrams(initialGrams); }, [initKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const byId = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);
  const selectedIds = Object.keys(grams).filter((id) => (grams[id] ?? 0) > 0 && byId.has(id));

  const filtered = search.trim()
    ? ingredients.filter((i) => i.name.toLowerCase().includes(search.trim().toLowerCase()))
    : ingredients;
  const groups = useMemo(() => {
    const m = new Map<string, Ingredient[]>();
    for (const ing of filtered) {
      const c = ing.category || "other";
      if (!m.has(c)) m.set(c, []);
      m.get(c)!.push(ing);
    }
    const order = [...CATEGORY_ORDER, ...[...m.keys()].filter((c) => !CATEGORY_ORDER.includes(c))];
    return order.filter((c) => m.has(c)).map((c) => [c, m.get(c)!] as const);
  }, [filtered]);

  const totals = selectedIds.reduce(
    (a, id) => {
      const mm = ingredientMacros(byId.get(id)!, grams[id]);
      return { calories: a.calories + mm.calories, protein: a.protein + mm.protein, carbs: a.carbs + mm.carbs, fat: a.fat + mm.fat, fiber: a.fiber + mm.fiber };
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 },
  );

  // Push the running totals up so the screen's day preview updates live.
  useEffect(() => {
    onTotalsChange?.(totals);
  }, [totals.calories, totals.protein, totals.carbs, totals.fat, totals.fiber]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = (id: string) => setGrams((g) => ({ ...g, [id]: g[id] && g[id] > 0 ? g[id] : 100 }));
  const setG = (id: string, v: number) => setGrams((g) => ({ ...g, [id]: Math.max(0, Math.round(v)) }));
  const remove = (id: string) => setGrams((g) => { const n = { ...g }; delete n[id]; return n; });

  async function onLog() {
    setBusy(true);
    const items = selectedIds.map((id) => {
      const ing = byId.get(id)!;
      const m = ingredientMacros(ing, grams[id]);
      return { ingredient_id: id, name: ing.name, grams: grams[id], calories: m.calories, protein: m.protein, carbs: m.carbs, fat: m.fat, fiber: m.fiber };
    });
    const ok = await logComposedMeal(date, slot, items);
    // Edit = replace: only remove the original after the new one is logged.
    if (ok && editMealId != null) await deleteMeal(editMealId);
    setBusy(false);
    if (ok) { setGrams({}); onLogged(); }
  }

  return (
    <View className="gap-3">
      {/* Selected ingredients — gram editors + live macros */}
      {selectedIds.length ? (
        <View className="gap-2 rounded-lg border border-border-subtle p-3">
          <Text variant="eyebrow" className="text-text-muted">In this meal</Text>
          {selectedIds.map((id) => {
            const ing = byId.get(id)!;
            const g = grams[id];
            const m = ingredientMacros(ing, g);
            return (
              <View key={id} className="flex-row items-center gap-2 border-b border-border-subtle pb-1.5">
                <View className="flex-1">
                  <Text variant="caption" className="text-text" numberOfLines={1}>{ing.name}</Text>
                  <Text variant="micro" className="text-text-muted tabular-nums">
                    {Math.round(m.calories)} kcal · P{Math.round(m.protein)} C{Math.round(m.carbs)} F{Math.round(m.fat)}
                  </Text>
                </View>
                <View className="flex-row items-center gap-1">
                  <Button label="−" variant="ghost" size="sm" onPress={() => setG(id, g - 10)} />
                  <Text variant="caption" className="w-14 text-center tabular-nums">{g} g</Text>
                  <Button label="+" variant="ghost" size="sm" onPress={() => setG(id, g + 10)} />
                  <Button label="✕" variant="ghost" size="sm" onPress={() => remove(id)} />
                </View>
              </View>
            );
          })}
          <View className="flex-row items-center justify-between pt-1">
            <Text variant="caption" className="font-semibold tabular-nums">
              {Math.round(totals.calories)} kcal · P{Math.round(totals.protein)} C{Math.round(totals.carbs)} F{Math.round(totals.fat)}
            </Text>
            <Button label={busy ? "…" : editMealId != null ? "Save changes" : "Log meal"} variant="primary" size="sm" disabled={busy || selectedIds.length === 0} onPress={onLog} />
          </View>
        </View>
      ) : null}

      {/* Search + category-grouped ingredient picker */}
      <TextInput
        placeholder="Search ingredients…"
        placeholderTextColor="#5a7a8a"
        value={search}
        onChangeText={setSearch}
        className="rounded-md border border-border-subtle px-3 py-2 text-text"
      />
      <ScrollView className="max-h-72" keyboardShouldPersistTaps="handled">
        {groups.length === 0 ? (
          <Text variant="caption" className="text-text-muted">No ingredients match.</Text>
        ) : groups.map(([cat, list]) => (
          <View key={cat} className="mb-2">
            <Text variant="micro" className="mb-1 text-text-muted">{CATEGORY_LABELS[cat] ?? cat}</Text>
            {list.map((ing) => {
              const on = (grams[ing.id] ?? 0) > 0;
              return (
                <Pressable key={ing.id} onPress={() => (on ? remove(ing.id) : add(ing.id))} className="flex-row items-center justify-between border-b border-border-subtle py-1.5">
                  <Text variant="caption" className={on ? "text-teal" : "text-text"} numberOfLines={1}>{ing.name}</Text>
                  <Text variant="micro" className="text-text-muted tabular-nums">{on ? "✓ " : ""}{Math.round(ing.calories_per_100g)}/100g</Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
