import { useMemo } from "react";
import { View, ScrollView, Pressable } from "react-native";
import { Text, Button } from "soma-style";
import { ingredientMacros, presetItems, presetBaseMacros, type Ingredient, type Preset } from "../lib/api";

const MACRO_COLOR: Record<string, string> = { protein: "#b17850", carbs: "#6366b0", fat: "#cbe896" };

/** Selected-preset panel: scaled ingredient list + live macro preview + a
 *  Linked/Free proportions toggle with a 0.5–2.0x scale, plus Customize (seed a
 *  compose meal) and Log. Mirrors the web MealCard's selected-preset view so the
 *  app gets the same pre-log preview instead of a bare "Log" button. */
export function PresetPanel({
  preset, ingredients, multiplier, linked, onMultiplier, onToggleLinked, onCancel, onCustomize, onLog, logging,
}: {
  preset: Preset;
  ingredients: Ingredient[];
  multiplier: number;
  linked: boolean;
  onMultiplier: (v: number) => void;
  onToggleLinked: () => void;
  onCancel: () => void;
  onCustomize: () => void;
  onLog: () => void;
  logging: boolean;
}) {
  const byId = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);
  const items = useMemo(() => presetItems(preset), [preset]);
  const base = useMemo(() => presetBaseMacros(preset), [preset]);
  const clamp = (v: number) => Math.max(0.5, Math.min(2, Math.round(v * 20) / 20));
  const M = (n: number) => Math.round(n * multiplier);

  const grid: [string, number, string][] = [
    ["kcal", M(base.calories), "#c9d4de"],
    ["P", M(base.protein), MACRO_COLOR.protein],
    ["C", M(base.carbs), MACRO_COLOR.carbs],
    ["F", M(base.fat), MACRO_COLOR.fat],
  ];

  return (
    <View className="gap-3 rounded-lg border border-border-subtle p-3">
      <View className="flex-row items-center justify-between gap-2">
        <Text variant="body" className="font-semibold text-text" numberOfLines={1} style={{ flexShrink: 1 }}>{preset.name}</Text>
        <View className="flex-row items-center gap-2">
          <Pressable onPress={onToggleLinked} hitSlop={6}>
            <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: linked ? "#e0a45822" : "#142530" }}>
              <Text variant="micro" style={{ color: linked ? "#e0a458" : "#8aa0ac" }}>{linked ? "Linked" : "Free"}</Text>
            </View>
          </Pressable>
          <Pressable onPress={onCancel} hitSlop={8}><Text variant="body" className="text-text-muted">✕</Text></Pressable>
        </View>
      </View>

      {items.length ? (
        <ScrollView className="max-h-40" keyboardShouldPersistTaps="handled">
          {items.map((it) => {
            const ing = byId.get(it.ingredient_id);
            const g = Math.round(it.grams * multiplier);
            const mm = ing ? ingredientMacros(ing, g) : null;
            return (
              <View key={it.ingredient_id} className="flex-row items-center justify-between border-b border-border-subtle py-1">
                <Text variant="caption" className="flex-1 text-text-secondary" numberOfLines={1}>{ing?.name ?? it.ingredient_id}</Text>
                {mm ? <Text variant="micro" className="mr-2 text-text-muted tabular-nums">{Math.round(mm.calories)} kcal</Text> : null}
                <Text variant="micro" className="text-text-muted tabular-nums">{g} g</Text>
              </View>
            );
          })}
        </ScrollView>
      ) : null}

      {/* Live macro preview (base x multiplier) */}
      <View className="flex-row justify-between rounded-md px-1" style={{ backgroundColor: "#11202066" }}>
        {grid.map(([lab, val, col]) => (
          <View key={lab} className="items-center py-1">
            <Text variant="body" className="font-bold tabular-nums" style={{ color: col }}>{val}{lab === "kcal" ? "" : "g"}</Text>
            <Text variant="micro" className="text-text-muted">{lab}</Text>
          </View>
        ))}
      </View>

      {linked ? (
        <View className="flex-row items-center justify-between">
          <Text variant="caption" className="text-text-secondary">Scale</Text>
          <View className="flex-row items-center gap-1">
            <Button label="−" variant="ghost" size="sm" onPress={() => onMultiplier(clamp(multiplier - 0.05))} />
            <Text variant="caption" className="w-14 text-center tabular-nums">{multiplier.toFixed(2)}x</Text>
            <Button label="+" variant="ghost" size="sm" onPress={() => onMultiplier(clamp(multiplier + 0.05))} />
          </View>
        </View>
      ) : (
        <Text variant="micro" className="text-center text-text-muted">Tap Customize to adjust individual portions.</Text>
      )}

      <View className="flex-row gap-2">
        <Button label="Cancel" variant="ghost" size="sm" className="flex-1" onPress={onCancel} />
        <Button label="Customize" variant="secondary" size="sm" className="flex-1" onPress={onCustomize} />
        <Button label={logging ? "…" : "Log"} variant="primary" size="sm" className="flex-1" disabled={logging} onPress={onLog} />
      </View>
    </View>
  );
}
